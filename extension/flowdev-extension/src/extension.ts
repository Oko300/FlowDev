import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Status bar shows connection state
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(plug) FlowDev: Connecting...';
  statusBar.show();

  connectToServer();

  const connectCmd = vscode.commands.registerCommand('flowdev.connect', () => {
    connectToServer();
  });

  const disconnectCmd = vscode.commands.registerCommand('flowdev.disconnect', () => {
    socket?.disconnect();
    statusBar.text = '$(circle-slash) FlowDev: Disconnected';
  });

  context.subscriptions.push(connectCmd, disconnectCmd, statusBar);
}

function connectToServer() {
  const serverUrl = 'https://flowdev.onrender.com';

  if (socket) {
    socket.disconnect();
  }

  socket = io(serverUrl, {
    query: { userId: 'default' },
    reconnection: true,
    reconnectionDelay: 3000,
  });

  socket.on('connect', () => {
    statusBar.text = '$(radio-tower) FlowDev: Connected ✅';
    vscode.window.showInformationMessage('FlowDev connected — Claude can now see your workspace.');
  });

  socket.on('disconnect', () => {
    statusBar.text = '$(plug) FlowDev: Disconnected';
  });

  socket.on('connect_error', () => {
    statusBar.text = '$(error) FlowDev: Server not found';
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

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
}

async function executeTool(tool: string, params: any): Promise<any> {
  const root = getWorkspaceRoot();

  switch (tool) {

    case 'read_file': {
      const filePath = path.resolve(root, params.path);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${params.path}`);
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { content };
    }

    case 'write_file': {
      const filePath = path.resolve(root, params.path);
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, params.content, 'utf-8');
      const analysis = analyzeCode(params.path, params.content);
      return { success: true, analysis };
    }

    case 'run_command': {
      return new Promise((resolve) => {
        const cwd = params.cwd ? path.resolve(root, params.cwd) : root;
        exec(params.command, { cwd, timeout: 60000 }, (error, stdout, stderr) => {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: error ? (error.code ?? 1) : 0,
          });
        });
      });
    }

    case 'list_directory': {
      const dirPath = path.resolve(root, params.path || '.');
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory not found: ${params.path}`);
      }
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const output = items.map(item => {
        const prefix = item.isDirectory() ? '📁' : '📄';
        return `${prefix} ${item.name}`;
      }).join('\n');
      return { output: `Contents of ${params.path || '.'}:\n\n${output}` };
    }

    case 'get_project_structure': {
      function buildTree(dirPath: string, indent: string = '', maxDepth: number = 4, currentDepth: number = 0): string {
        if (currentDepth >= maxDepth) return '';
        const skip = ['node_modules', '.git', 'dist', 'out', '.vscode'];
        let result = '';
        try {
          const items = fs.readdirSync(dirPath, { withFileTypes: true });
          items.forEach(item => {
            if (skip.includes(item.name)) return;
            const prefix = item.isDirectory() ? '📁' : '📄';
            result += `${indent}${prefix} ${item.name}\n`;
            if (item.isDirectory()) {
              result += buildTree(path.join(dirPath, item.name), indent + '  ', maxDepth, currentDepth + 1);
            }
          });
        } catch {}
        return result;
      }
      const tree = buildTree(root);
      return { output: `📂 Project Structure (${root}):\n\n${tree}` };
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function analyzeCode(filePath: string, content: string): string {
  const issues: string[] = [];
  const lines = content.split('\n');

  lines.forEach((line, i) => {
    const n = i + 1;

    if (/api[_-]?key\s*=\s*['"][^'"]{8,}['"]/i.test(line) && !line.includes('process.env')) {
      issues.push(`🔒 Line ${n}: Hardcoded API key detected — use process.env instead`);
    }
    if (/password\s*=\s*['"][^'"]+['"]/i.test(line) && !line.includes('process.env')) {
      issues.push(`🔒 Line ${n}: Hardcoded password — use process.env instead`);
    }
    if (line.includes('http://') && !line.includes('localhost') && !line.includes('//')) {
      issues.push(`🔒 Line ${n}: HTTP used instead of HTTPS`);
    }
    if (line.includes('eval(')) {
      issues.push(`🔒 Line ${n}: eval() is dangerous — avoid it`);
    }
    if (line.match(/async\s+\w+/) && !content.includes('try') && !content.includes('catch')) {
      issues.push(`⚠️  Async function missing try/catch error handling`);
    }
    if (line.includes('console.log') && !filePath.includes('test')) {
      issues.push(`💡 Line ${n}: Remove console.log before production`);
    }
  });

  if (issues.length === 0) {
    return '✅ Code looks clean — no issues found';
  }
  return issues.slice(0, 5).join('\n');
}

export function deactivate() {
  socket?.disconnect();
}

