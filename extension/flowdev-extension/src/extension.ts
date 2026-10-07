import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let statusBar: vscode.StatusBarItem;
let settingsPanel: vscode.WebviewPanel | undefined;
let sidebarProvider: FlowDevSidebarProvider | undefined;
const SERVER_URL = 'https://flowdev.onrender.com';

export async function activate(context: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(plug) FlowDev';
  statusBar.tooltip = 'FlowDev — Click to open settings';
  statusBar.command = 'flowdev.openSettings';
  statusBar.show();

  sidebarProvider = new FlowDevSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('flowdev.settingsView', sidebarProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowdev.openSettings', () => openSettings(context)),
    vscode.commands.registerCommand('flowdev.connect', async () => {
      const token = await context.secrets.get('flowdev.token');
      if (token) { connectToServer(token, context); }
      else { openSettings(context); }
    }),
    vscode.commands.registerCommand('flowdev.disconnect', () => {
      socket?.disconnect();
      socket = null;
      statusBar.text = '$(circle-slash) FlowDev: Disconnected';
      statusBar.tooltip = 'FlowDev — Click to open settings';
    }),
    vscode.commands.registerCommand('flowdev.setToken', () => openSettings(context)),
    vscode.commands.registerCommand('flowdev.showStatus', () => openSettings(context)),
    statusBar
  );

  const token = await context.secrets.get('flowdev.token');
  if (token) {
    connectToServer(token, context);
  } else {
    statusBar.text = '$(key) FlowDev: Setup Required';
    statusBar.tooltip = 'Click to set up FlowDev';
    const shown = context.globalState.get('flowdev.welcomeShown');
    if (!shown) {
      context.globalState.update('flowdev.welcomeShown', true);
      const choice = await vscode.window.showInformationMessage(
        'FlowDev installed! Open settings to enter your access token and connect.',
        'Open FlowDev Settings',
        'Get Access Token'
      );
      if (choice === 'Open FlowDev Settings') { openSettings(context); }
      else if (choice === 'Get Access Token') {
        vscode.env.openExternal(vscode.Uri.parse(`${SERVER_URL}/request`));
      }
    }
  }
}

function openSettings(context: vscode.ExtensionContext) {
  if (settingsPanel) {
    settingsPanel.reveal(vscode.ViewColumn.One);
    return;
  }

  settingsPanel = vscode.window.createWebviewPanel(
    'flowdevSettings',
    'FlowDev Settings',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  settingsPanel.onDidDispose(() => { settingsPanel = undefined; });

  const isConnected = socket?.connected ?? false;
  settingsPanel.webview.html = getSettingsHTML(isConnected);

  settingsPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case 'saveToken': {
        const token = message.token?.trim();
        if (!token || token.length < 10) {
          settingsPanel?.webview.postMessage({ command: 'error', text: 'Token looks too short. Check your email and try again.' });
          return;
        }
        await context.secrets.store('flowdev.token', token);
        settingsPanel?.webview.postMessage({ command: 'status', text: 'Connecting...' });
        connectToServer(token, context);
        break;
      }
      case 'disconnect': {
        socket?.disconnect();
        socket = null;
        statusBar.text = '$(circle-slash) FlowDev: Disconnected';
        settingsPanel?.webview.postMessage({ command: 'disconnected' });
        break;
      }
      case 'clearToken': {
        await context.secrets.delete('flowdev.token');
        socket?.disconnect();
        socket = null;
        statusBar.text = '$(key) FlowDev: Setup Required';
        settingsPanel?.webview.postMessage({ command: 'cleared' });
        break;
      }
      case 'getAccess': {
        vscode.env.openExternal(vscode.Uri.parse(`${SERVER_URL}/request`));
        break;
      }
      case 'copyUrl': {
        vscode.env.clipboard.writeText(message.url);
        vscode.window.showInformationMessage('MCP URL copied to clipboard!');
        break;
      }
    }
  }, undefined, context.subscriptions);
}

function connectToServer(token: string, context: vscode.ExtensionContext, view?: vscode.WebviewView) {
  if (socket) { socket.disconnect(); }

  const mcpUrl = `${SERVER_URL}/mcp?token=${token}`;

  statusBar.text = '$(sync~spin) FlowDev: Connecting...';
  statusBar.tooltip = 'FlowDev — Connecting... (server may take ~30s to wake up)';

  socket = io(SERVER_URL, {
    query: { userId: token },
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
    timeout: 30000,
  });

  const notify = (msg: any) => {
    settingsPanel?.webview.postMessage(msg);
    view?.webview.postMessage(msg);
    sidebarProvider?.notify(msg);
  };

  socket.on('connect', () => {
    statusBar.text = '$(radio-tower) FlowDev: Connected';
    statusBar.tooltip = 'FlowDev — Connected. Click to open settings.';
    notify({ command: 'connected', mcpUrl });
  });

  socket.on('disconnect', () => {
    statusBar.text = '$(sync~spin) FlowDev: Reconnecting...';
    statusBar.tooltip = 'FlowDev — Lost connection, retrying automatically...';
    notify({ command: 'reconnecting', mcpUrl });
  });

  socket.on('connect_error', () => {
    if (!statusBar.text.includes('Waking') && !statusBar.text.includes('Reconnecting')) {
      statusBar.text = '$(sync~spin) FlowDev: Waking server...';
      statusBar.tooltip = 'FlowDev — Server waking up, will connect automatically...';
    }
    notify({ command: 'waking', mcpUrl });
  });

  socket.on('execute_tool', async ({ requestId, tool, params }: any) => {
    try {
      const result = await executeTool(tool, params);
      socket?.emit('tool_result', { requestId, success: true, data: result });
    } catch (err: any) {
      socket?.emit('tool_result', { requestId, success: false, error: err.message });
    }
  });
}

function getSettingsHTML(isConnected: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowDev Settings</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 32px;
      max-width: 640px;
    }
    .logo { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .logo span { color: #6366f1; }
    .tagline { color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 32px; }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .card h2 { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
    .card p { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; line-height: 1.6; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .status-badge.connected { background: #14532d; color: #4ade80; }
    .status-badge.disconnected { background: #3b1515; color: #f87171; }
    .status-badge.connecting { background: #1c2a4a; color: #60a5fa; }
    input[type="text"], input[type="password"] {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 13px;
      margin-bottom: 12px;
      outline: none;
    }
    input:focus { border-color: #6366f1; }
    .btn {
      display: inline-block;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      margin-right: 8px;
      margin-bottom: 8px;
    }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #5558e3; }
    .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-danger { background: #7f1d1d; color: #fca5a5; }
    .mcp-url {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      font-family: monospace;
      word-break: break-all;
      margin-bottom: 12px;
      color: #60a5fa;
    }
    .alert {
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 12px;
      display: none;
    }
    .alert-error { background: #3b1515; color: #f87171; border: 1px solid #7f1d1d; }
    .alert-success { background: #14532d; color: #4ade80; border: 1px solid #166534; }
    .steps { counter-reset: steps; }
    .step { display: flex; gap: 12px; margin-bottom: 16px; font-size: 13px; }
    .step-num {
      width: 24px; height: 24px; border-radius: 50%;
      background: #6366f1; color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; flex-shrink: 0;
    }
    .step-text { padding-top: 2px; line-height: 1.6; color: var(--vscode-descriptionForeground); }
    .step-text strong { color: var(--vscode-foreground); }
    a { color: #6366f1; text-decoration: none; }
    a:hover { text-decoration: underline; }
    #connected-section { display: none; }
    #setup-section { display: block; }
  </style>
</head>
<body>
  <div class="logo">Flow<span>Dev</span></div>
  <p class="tagline">Connect any MCP-compatible AI directly to your VS Code workspace</p>

  <div id="connected-section">
    <div class="card">
      <h2>Connection Status</h2>
      <div class="status-badge connected" id="status-badge">● Connected</div>
      <p>Your AI can now read files, write code, search your codebase, run commands, and push to GitHub.</p>
      <p style="margin-bottom:16px"><strong>Your MCP connector URL:</strong></p>
      <div class="mcp-url" id="mcp-url-display">Connecting...</div>
      <button class="btn btn-secondary" onclick="copyUrl()">Copy URL</button>
      <button class="btn btn-danger" onclick="disconnect()">Disconnect</button>
    </div>
    <div class="card">
      <h2>How to Use</h2>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text">Open <strong>Claude.ai</strong> (or Cursor, Windsurf, Cline, Continue)</div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Go to <strong>Settings → Connectors → Add Custom Connector</strong></div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Paste your MCP URL above and save</div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text">Enable the connector in any chat and start building</div></div>
      </div>
    </div>
  </div>

  <div id="setup-section">
    <div class="card">
      <h2>Enter Your Access Token</h2>
      <p>Paste the token from your approval email. If you do not have one yet, request access first.</p>
      <div class="alert alert-error" id="error-msg"></div>
      <div class="alert alert-success" id="success-msg"></div>
      <input type="password" id="token-input" placeholder="Paste your FlowDev token here..." />
      <button class="btn btn-primary" onclick="saveToken()">Connect</button>
      <button class="btn btn-secondary" onclick="getAccess()">Request Access Token</button>
    </div>
    <div class="card">
      <h2>How to Get Started</h2>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text"><strong>Request access</strong> at <a href="#" onclick="getAccess()">flowdev.onrender.com/request</a></div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text"><strong>Check your email</strong> for approval and your personal token</div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text"><strong>Paste the token</strong> above and click Connect</div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text"><strong>Add the MCP connector</strong> in Claude.ai, Cursor, Windsurf, or any MCP-compatible AI</div></div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentMcpUrl = '';

    function saveToken() {
      const token = document.getElementById('token-input').value.trim();
      if (!token) { showError('Please paste your token first.'); return; }
      showSuccess('Connecting...');
      vscode.postMessage({ command: 'saveToken', token });
    }
    function disconnect() { vscode.postMessage({ command: 'disconnect' }); }
    function getAccess() { vscode.postMessage({ command: 'getAccess' }); }
    function copyUrl() { vscode.postMessage({ command: 'copyUrl', url: currentMcpUrl }); }

    function showError(text) {
      const el = document.getElementById('error-msg');
      el.textContent = text; el.style.display = 'block';
      document.getElementById('success-msg').style.display = 'none';
    }
    function showSuccess(text) {
      const el = document.getElementById('success-msg');
      el.textContent = text; el.style.display = 'block';
      document.getElementById('error-msg').style.display = 'none';
    }
    function showConnected(mcpUrl) {
      currentMcpUrl = mcpUrl;
      document.getElementById('connected-section').style.display = 'block';
      document.getElementById('setup-section').style.display = 'none';
      document.getElementById('mcp-url-display').textContent = mcpUrl;
      document.getElementById('status-badge').textContent = '● Connected';
      document.getElementById('status-badge').className = 'status-badge connected';
    }
    function showDisconnected() {
      document.getElementById('connected-section').style.display = 'none';
      document.getElementById('setup-section').style.display = 'block';
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.command) {
        case 'connected': showConnected(msg.mcpUrl); break;
        case 'disconnected': case 'cleared': showDisconnected(); break;
        case 'reconnecting':
          if (msg.mcpUrl) { currentMcpUrl = msg.mcpUrl; document.getElementById('mcp-url-display').textContent = msg.mcpUrl; }
          document.getElementById('connected-section').style.display = 'block';
          document.getElementById('setup-section').style.display = 'none';
          document.getElementById('status-badge').textContent = '● Reconnecting...';
          document.getElementById('status-badge').className = 'status-badge connecting';
          break;
        case 'waking':
          if (msg.mcpUrl) { currentMcpUrl = msg.mcpUrl; document.getElementById('mcp-url-display').textContent = msg.mcpUrl; }
          document.getElementById('connected-section').style.display = 'block';
          document.getElementById('setup-section').style.display = 'none';
          document.getElementById('status-badge').textContent = '● Waking server...';
          document.getElementById('status-badge').className = 'status-badge connecting';
          break;
        case 'error': showError(msg.text); break;
        case 'status': showSuccess(msg.text); break;
      }
    });
    document.getElementById('token-input').focus();
  </script>
</body>
</html>`;
}

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
}

async function executeTool(tool: string, params: any): Promise<any> {
  const root = getWorkspaceRoot();

  switch (tool) {

    // ── ping ────────────────────────────────────────────────────────────────
    case 'ping': {
      return {
        status: 'online',
        workspace: root,
        platform: process.platform,
        timestamp: new Date().toISOString(),
      };
    }

    // ── read_file ───────────────────────────────────────────────────────────
    case 'read_file': {
      const filePath = path.resolve(root, params.path);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${params.path}`);
      return { content: fs.readFileSync(filePath, 'utf-8') };
    }

    // ── write_file ──────────────────────────────────────────────────────────
    case 'write_file': {
      const filePath = path.resolve(root, params.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, params.content, 'utf-8');
      return { success: true, analysis: analyzeCode(params.path, params.content) };
    }

    // ── find_and_replace ────────────────────────────────────────────────────
    // Safer than rewriting the whole file — perfect for renaming functions,
    // updating values, or fixing a single line without touching the rest.
    case 'find_and_replace': {
      const filePath = path.resolve(root, params.path);
      if (!filePath.startsWith(root)) throw new Error('Cannot access files outside the workspace');
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${params.path}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(params.find)) {
        throw new Error(`Text not found in file: "${params.find.substring(0, 60)}..."`);
      }
      const count = content.split(params.find).length - 1;
      const newContent = content.split(params.find).join(params.replace);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      return {
        success: true,
        message: `Replaced ${count} occurrence${count === 1 ? '' : 's'} in ${params.path}`,
        analysis: analyzeCode(params.path, newContent)
      };
    }

    // ── search_in_files ─────────────────────────────────────────────────────
    // Grep-like search across all project source files.
    case 'search_in_files': {
      const { query, caseSensitive } = params;
      const results: string[] = [];
      const skipDirs = new Set(['node_modules', '.git', 'dist', 'out', '.vscode', '.kilo', 'build', 'coverage']);
      const textExts = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
        '.json', '.md', '.txt', '.css', '.scss', '.html', '.htm',
        '.py', '.go', '.rs', '.rb', '.java', '.php', '.swift', '.kt',
        '.yaml', '.yml', '.toml', '.env', '.sh', '.bash', '.sql', '.graphql'
      ]);

      const searchQuery = caseSensitive ? query : query.toLowerCase();

      function searchDir(dir: string) {
        try {
          for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            if (item.isDirectory()) {
              if (!skipDirs.has(item.name)) searchDir(path.join(dir, item.name));
              continue;
            }
            const ext = path.extname(item.name).toLowerCase();
            if (!textExts.has(ext)) continue;
            const fullPath = path.join(dir, item.name);
            try {
              const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
              const relPath = path.relative(root, fullPath);
              lines.forEach((line, i) => {
                const searchLine = caseSensitive ? line : line.toLowerCase();
                if (searchLine.includes(searchQuery)) {
                  results.push(`${relPath}:${i + 1}:  ${line.trim()}`);
                }
              });
            } catch { /* skip unreadable files */ }
            if (results.length >= 200) return; // cap early
          }
        } catch { /* skip unreadable dirs */ }
      }

      searchDir(root);

      if (results.length === 0) return { output: `No results found for "${query}"` };
      const capped = results.length > 100;
      return {
        output: `Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${query}"${capped ? ' (showing first 100)' : ''}:\n\n${results.slice(0, 100).join('\n')}`
      };
    }

    // ── create_directory ────────────────────────────────────────────────────
    case 'create_directory': {
      const dirPath = path.resolve(root, params.path);
      if (!dirPath.startsWith(root)) throw new Error('Cannot create directories outside the workspace');
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true, message: `Created directory: ${params.path}` };
    }

    // ── delete_file ─────────────────────────────────────────────────────────
    case 'delete_file': {
      const filePath = path.resolve(root, params.path);
      if (!filePath.startsWith(root)) throw new Error('Cannot delete files outside the workspace');
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${params.path}`);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) throw new Error(`${params.path} is a directory. Use run_command with "rm -rf" if you really want to delete it.`);
      fs.unlinkSync(filePath);
      return { success: true, message: `Deleted: ${params.path}` };
    }

    // ── rename_file ─────────────────────────────────────────────────────────
    case 'rename_file': {
      const oldPath = path.resolve(root, params.old_path);
      const newPath = path.resolve(root, params.new_path);
      if (!oldPath.startsWith(root) || !newPath.startsWith(root)) {
        throw new Error('Cannot move files outside the workspace');
      }
      if (!fs.existsSync(oldPath)) throw new Error(`File not found: ${params.old_path}`);
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.renameSync(oldPath, newPath);
      return { success: true, message: `Renamed: ${params.old_path} → ${params.new_path}` };
    }

    // ── git_diff ────────────────────────────────────────────────────────────
    case 'git_diff': {
      const cmd = params.staged ? 'git diff --staged' : 'git diff';
      return runShell(cmd, root);
    }

    // ── run_command ─────────────────────────────────────────────────────────
    case 'run_command': {
      return new Promise((resolve) => {
        const cwd = params.cwd ? path.resolve(root, params.cwd) : root;
        exec(params.command, { cwd, timeout: 60000 }, (error, stdout, stderr) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: error ? (error.code ?? 1) : 0 });
        });
      });
    }

    // ── list_directory ──────────────────────────────────────────────────────
    case 'list_directory': {
      const dirPath = path.resolve(root, params.path || '.');
      if (!fs.existsSync(dirPath)) throw new Error(`Directory not found: ${params.path}`);
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return { output: items.map(i => `${i.isDirectory() ? '📁' : '📄'} ${i.name}`).join('\n') };
    }

    // ── get_project_structure ───────────────────────────────────────────────
    case 'get_project_structure': {
      return { output: buildTree(root) };
    }

    // ── git_status ──────────────────────────────────────────────────────────
    case 'git_status': {
      return runShell('git status', root);
    }

    // ── git_add ─────────────────────────────────────────────────────────────
    case 'git_add': {
      return runShell(`git add ${params.files || '.'}`, root);
    }

    // ── git_commit ──────────────────────────────────────────────────────────
    case 'git_commit': {
      return runShell(`git commit -m "${params.message.replace(/"/g, '\\"')}"`, root);
    }

    // ── git_push ────────────────────────────────────────────────────────────
    case 'git_push': {
      return runShell(`git push origin ${params.branch || 'main'}`, root);
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function runShell(command: string, cwd: string): Promise<any> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: error ? (error.code ?? 1) : 0 });
    });
  });
}

function buildTree(dirPath: string, indent = '', depth = 0, maxDepth = 4): string {
  if (depth >= maxDepth) return '';
  const skip = ['node_modules', '.git', 'dist', 'out', '.vscode', '.kilo', 'build', 'coverage'];
  let result = '';
  try {
    for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (skip.includes(item.name)) continue;
      result += `${indent}${item.isDirectory() ? '📁' : '📄'} ${item.name}\n`;
      if (item.isDirectory()) {
        result += buildTree(path.join(dirPath, item.name), indent + '  ', depth + 1, maxDepth);
      }
    }
  } catch {}
  return result;
}

function analyzeCode(filePath: string, content: string): string {
  const issues: string[] = [];
  content.split('\n').forEach((line, i) => {
    const n = i + 1;
    if (/api[_-]?key\s*=\s*['"][^'"]{8,}['"]/i.test(line) && !line.includes('process.env'))
      issues.push(`🔒 Line ${n}: Hardcoded API key detected`);
    if (/password\s*=\s*['"][^'"]+['"]/i.test(line) && !line.includes('process.env'))
      issues.push(`🔒 Line ${n}: Hardcoded password detected`);
    if (line.includes('http://') && !line.includes('localhost'))
      issues.push(`🔒 Line ${n}: HTTP used instead of HTTPS`);
    if (line.includes('eval('))
      issues.push(`⚠️ Line ${n}: eval() is dangerous`);
    if (line.includes('console.log') && !filePath.includes('test'))
      issues.push(`💡 Line ${n}: Remove console.log before production`);
  });
  return issues.length === 0 ? '✅ Code looks clean' : issues.slice(0, 5).join('\n');
}

class FlowDevSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHTML();

    this.context.secrets.get('flowdev.token').then(token => {
      if (!token) return;
      if (socket?.connected) {
        this._view?.webview.postMessage({ command: 'connected', mcpUrl: `${SERVER_URL}/mcp?token=${token}` });
      } else {
        this._view?.webview.postMessage({ command: 'reconnecting', mcpUrl: `${SERVER_URL}/mcp?token=${token}` });
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'saveToken': {
          const token = message.token?.trim();
          if (!token || token.length < 10) {
            this._view?.webview.postMessage({ command: 'error', text: 'Token too short. Check your email.' });
            return;
          }
          await this.context.secrets.store('flowdev.token', token);
          this._view?.webview.postMessage({ command: 'status', text: 'Connecting...' });
          connectToServer(token, this.context, this._view);
          break;
        }
        case 'disconnect': {
          socket?.disconnect();
          socket = null;
          statusBar.text = '$(plug) FlowDev';
          await this.context.secrets.delete('flowdev.token');
          this._view?.webview.postMessage({ command: 'cleared' });
          break;
        }
        case 'getAccess': {
          vscode.env.openExternal(vscode.Uri.parse(`${SERVER_URL}/request`));
          break;
        }
        case 'copyUrl': {
          vscode.env.clipboard.writeText(message.url);
          vscode.window.showInformationMessage('MCP URL copied!');
          break;
        }
      }
    });
  }

  notify(message: any) {
    this._view?.webview.postMessage(message);
  }

  getHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:var(--vscode-font-family); font-size:var(--vscode-font-size); color:var(--vscode-foreground); background:var(--vscode-sideBar-background); padding:12px; }
  .logo { font-size:15px; font-weight:700; margin-bottom:2px; }
  .logo span { color:#6366f1; }
  .sub { font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:16px; }
  .section { margin-bottom:16px; }
  label { display:block; font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }
  input { width:100%; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); border-radius:4px; padding:6px 8px; font-size:12px; margin-bottom:8px; outline:none; }
  input:focus { border-color:#6366f1; }
  .btn { display:block; width:100%; padding:6px 10px; border-radius:4px; font-size:12px; font-weight:600; cursor:pointer; border:none; margin-bottom:6px; text-align:center; }
  .btn-primary { background:#6366f1; color:white; }
  .btn-primary:hover { background:#5558e3; }
  .btn-secondary { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }
  .btn-danger { background:transparent; color:#f87171; border:1px solid #7f1d1d; }
  .status { display:flex; align-items:center; gap:6px; font-size:12px; margin-bottom:12px; }
  .dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .dot-green { background:#4ade80; }
  .dot-yellow { background:#facc15; animation:pulse 1.5s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .mcp-url { background:var(--vscode-input-background); border:1px solid var(--vscode-panel-border); border-radius:4px; padding:6px 8px; font-size:10px; font-family:monospace; word-break:break-all; color:#60a5fa; margin-bottom:8px; line-height:1.4; }
  .alert { font-size:11px; padding:6px 8px; border-radius:4px; margin-bottom:8px; display:none; }
  .alert-error { background:#3b1515; color:#f87171; }
  .alert-success { background:#14532d; color:#4ade80; }
  .divider { border:none; border-top:1px solid var(--vscode-panel-border); margin:12px 0; }
  .link { color:#6366f1; font-size:11px; cursor:pointer; text-decoration:underline; background:none; border:none; padding:0; display:block; margin-bottom:6px; text-align:left; }
  #connected-view { display:none; }
  #setup-view { display:block; }
</style>
</head>
<body>
<div class="logo">Flow<span>Dev</span></div>
<p class="sub">AI coding assistant bridge</p>

<div id="connected-view">
  <div class="status">
    <div class="dot dot-green" id="status-dot"></div>
    <span id="status-text">Connected</span>
  </div>
  <div class="section">
    <label>Your MCP URL</label>
    <div class="mcp-url" id="mcp-url">Loading...</div>
    <button class="btn btn-secondary" onclick="copyUrl()">Copy MCP URL</button>
  </div>
  <hr class="divider">
  <div class="section">
    <label>Add to Claude.ai</label>
    <p style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;line-height:1.5">Settings → Connectors → Add Custom Connector → paste your MCP URL</p>
  </div>
  <hr class="divider">
  <button class="btn btn-danger" onclick="disconnect()">Disconnect & Clear Token</button>
</div>

<div id="setup-view">
  <div class="section">
    <div class="alert alert-error" id="error-msg"></div>
    <div class="alert alert-success" id="success-msg"></div>
    <label>Access Token</label>
    <input type="password" id="token-input" placeholder="Paste token from email..." />
    <button class="btn btn-primary" onclick="saveToken()">Connect</button>
  </div>
  <hr class="divider">
  <div class="section">
    <label>Don't have a token?</label>
    <button class="link" onclick="getAccess()">Request free access →</button>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let mcpUrl = '';

  function saveToken() {
    const token = document.getElementById('token-input').value.trim();
    if (!token) { showError('Paste your token first.'); return; }
    showSuccess('Connecting...');
    vscode.postMessage({ command: 'saveToken', token });
  }
  function disconnect() { vscode.postMessage({ command: 'disconnect' }); showSetup(); }
  function getAccess() { vscode.postMessage({ command: 'getAccess' }); }
  function copyUrl() { vscode.postMessage({ command: 'copyUrl', url: mcpUrl }); }

  function showError(text) {
    const el = document.getElementById('error-msg');
    el.textContent = text; el.style.display = 'block';
    document.getElementById('success-msg').style.display = 'none';
  }
  function showSuccess(text) {
    const el = document.getElementById('success-msg');
    el.textContent = text; el.style.display = 'block';
    document.getElementById('error-msg').style.display = 'none';
  }
  function showConnected(url) {
    mcpUrl = url;
    document.getElementById('mcp-url').textContent = url;
    document.getElementById('connected-view').style.display = 'block';
    document.getElementById('setup-view').style.display = 'none';
    document.getElementById('status-dot').className = 'dot dot-green';
    document.getElementById('status-text').textContent = 'Connected';
  }
  function showReconnecting(url) {
    if (url) { mcpUrl = url; document.getElementById('mcp-url').textContent = url; }
    document.getElementById('connected-view').style.display = 'block';
    document.getElementById('setup-view').style.display = 'none';
    document.getElementById('status-dot').className = 'dot dot-yellow';
    document.getElementById('status-text').textContent = 'Reconnecting...';
  }
  function showWaking(url) {
    if (url) { mcpUrl = url; document.getElementById('mcp-url').textContent = url; }
    document.getElementById('connected-view').style.display = 'block';
    document.getElementById('setup-view').style.display = 'none';
    document.getElementById('status-dot').className = 'dot dot-yellow';
    document.getElementById('status-text').textContent = 'Waking server...';
  }
  function showSetup() {
    document.getElementById('connected-view').style.display = 'none';
    document.getElementById('setup-view').style.display = 'block';
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'connected') showConnected(msg.mcpUrl);
    else if (msg.command === 'cleared' || msg.command === 'disconnected') showSetup();
    else if (msg.command === 'reconnecting') showReconnecting(msg.mcpUrl);
    else if (msg.command === 'waking') showWaking(msg.mcpUrl);
    else if (msg.command === 'error') showError(msg.text);
    else if (msg.command === 'status') showSuccess(msg.text);
    else if (msg.command === 'hasToken') showReconnecting('');
  });
</script>
</body>
</html>`;
  }
}

export function deactivate() {
  socket?.disconnect();
}
