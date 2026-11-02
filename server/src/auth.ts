import express from 'express';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { registerToken } from './admin';

const sql = neon(process.env.DATABASE_URL!);
export const authRouter = express.Router();

const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID     || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const PUBLIC_URL           = process.env.PUBLIC_URL || 'https://flowdev.onrender.com';

// ─────────────────────────────────────────────────────────────────────────────
// DB migration — add GitHub columns to fd_users if they don't exist yet
// ─────────────────────────────────────────────────────────────────────────────
export async function migrateGithubColumns() {
  await sql`ALTER TABLE fd_users ADD COLUMN IF NOT EXISTS github_id TEXT`;
  await sql`ALTER TABLE fd_users ADD COLUMN IF NOT EXISTS github_username TEXT`;
  await sql`ALTER TABLE fd_users ADD COLUMN IF NOT EXISTS avatar_url TEXT`;
  // Unique index: one FlowDev token per GitHub account
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS fd_users_github_id_unique
    ON fd_users(github_id)
    WHERE github_id IS NOT NULL
  `;
  console.log('✅ GitHub OAuth columns ready');
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store for OAuth state params (prevents CSRF)
// TTL: 10 minutes per state. Small footprint, no Redis needed.
// ─────────────────────────────────────────────────────────────────────────────
const oauthStates = new Map<string, number>();

function createState(): string {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now() + 10 * 60 * 1000);
  // Clean up expired states
  for (const [k, exp] of oauthStates) {
    if (Date.now() > exp) oauthStates.delete(k);
  }
  return state;
}

function validateState(state: string): boolean {
  const exp = oauthStates.get(state);
  if (!exp || Date.now() > exp) return false;
  oauthStates.delete(state); // one-time use
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/github
// Kicks off the GitHub OAuth flow
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get('/auth/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(503).send('GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.');
    return;
  }
  const state = createState();
  const params = new URLSearchParams({
    client_id:    GITHUB_CLIENT_ID,
    redirect_uri: `${PUBLIC_URL}/auth/github/callback`,
    scope:        'user:email read:user',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /auth/github/callback
// GitHub redirects here after the user authorises
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get('/auth/github/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.redirect(`/login?error=${encodeURIComponent('GitHub login was cancelled or denied.')}`);
    return;
  }

  if (!code || !state || !validateState(state)) {
    res.redirect('/login?error=' + encodeURIComponent('Invalid or expired OAuth state. Please try again.'));
    return;
  }

  try {
    // ── Step 1: Exchange code for GitHub access token ──────────────────────
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${PUBLIC_URL}/auth/github/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as any;

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to get GitHub access token');
    }

    // ── Step 2: Fetch GitHub user profile ─────────────────────────────────
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'User-Agent':    'FlowDev-MCP/1.0',
        'Accept':        'application/vnd.github+json',
      },
    });
    const ghUser = await userRes.json() as any;

    if (!ghUser.id) {
      throw new Error('Could not fetch GitHub user profile');
    }

    const githubId       = String(ghUser.id);
    const githubUsername = ghUser.login as string;
    const avatarUrl      = ghUser.avatar_url as string || '';
    const name           = (ghUser.name as string) || githubUsername;
    const email          = (ghUser.email as string) || `${githubUsername}@github`;

    // ── Step 3: One token per GitHub account ──────────────────────────────
    const existing = await sql`
      SELECT token, github_username FROM fd_users
      WHERE github_id = ${githubId}
      LIMIT 1
    `;

    let flowdevToken: string;

    if (existing.length > 0 && existing[0].token) {
      // Already has a token — reuse it
      flowdevToken = existing[0].token;
    } else if (existing.length > 0 && !existing[0].token) {
      // Row exists but no token — regenerate
      flowdevToken = crypto.randomBytes(32).toString('hex');
      await sql`
        UPDATE fd_users
        SET token = ${flowdevToken}, status = 'approved', approved_at = NOW(),
            github_username = ${githubUsername}, avatar_url = ${avatarUrl}, name = ${name}
        WHERE github_id = ${githubId}
      `;
    } else {
      // Brand new user — insert with approved status immediately
      flowdevToken = crypto.randomBytes(32).toString('hex');
      await sql`
        INSERT INTO fd_users
          (name, email, reason, status, token, github_id, github_username, avatar_url, approved_at)
        VALUES
          (${name}, ${email}, 'GitHub OAuth', 'approved', ${flowdevToken},
           ${githubId}, ${githubUsername}, ${avatarUrl}, NOW())
      `;
    }

    // ── Step 4: Register token in memory so it's valid immediately ─────────
    registerToken(flowdevToken);

    // ── Step 5: Redirect to dashboard ──────────────────────────────────────
    // Token passed via URL fragment — never hits server logs
    res.redirect(`/dashboard#token=${flowdevToken}&user=${encodeURIComponent(githubUsername)}&avatar=${encodeURIComponent(avatarUrl)}&name=${encodeURIComponent(name)}`);

  } catch (err: any) {
    console.error('GitHub OAuth error:', err.message);
    res.redirect('/login?error=' + encodeURIComponent('Authentication failed: ' + err.message));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /login  —  "Sign in with GitHub" landing page
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get('/login', (req, res) => {
  const error = req.query.error as string || '';
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>FlowDev — Sign In</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><polygon points='14,2 7,13 11.5,13 9.5,22 17,11 12,11' fill='%236366f1'/></svg>">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:48px 40px;max-width:420px;width:100%;text-align:center}
    .logo{font-size:28px;font-weight:800;margin-bottom:6px}.logo span{color:#6366f1}
    .tagline{color:#8b949e;font-size:14px;margin-bottom:40px}
    .github-btn{display:inline-flex;align-items:center;gap:10px;background:#fff;color:#0d1117;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;transition:background .15s}
    .github-btn:hover{background:#e6edf3}
    .github-btn svg{flex-shrink:0}
    .error{background:#3b1515;color:#f87171;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;font-size:13px;margin-bottom:24px;display:${error ? 'block' : 'none'}}
    .perks{margin-top:36px;text-align:left;border-top:1px solid #30363d;padding-top:28px}
    .perk{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;font-size:13px;color:#8b949e}
    .perk-icon{color:#6366f1;font-size:16px;flex-shrink:0;margin-top:-1px}
    .perk strong{color:#e6edf3}
    .footer{margin-top:28px;font-size:12px;color:#484f58}
    .footer a{color:#6366f1;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Flow<span>Dev</span></div>
    <p class="tagline">Your AI codes directly inside VS Code</p>
    <div class="error">${error}</div>
    <a href="/auth/github" class="github-btn">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"/>
      </svg>
      Continue with GitHub
    </a>
    <div class="perks">
      <div class="perk"><span class="perk-icon">⚡</span><div><strong>Instant access</strong> — no waiting for manual approval</div></div>
      <div class="perk"><span class="perk-icon">🔒</span><div><strong>One token per account</strong> — tied to your GitHub identity</div></div>
      <div class="perk"><span class="perk-icon">🛠️</span><div><strong>16 tools</strong> — read, write, search, terminal, full git workflow</div></div>
      <div class="perk"><span class="perk-icon">🤖</span><div><strong>Works with</strong> Claude, Cursor, Windsurf, Cline, Continue</div></div>
    </div>
    <div class="footer">
      By signing in you agree to use FlowDev responsibly.<br>
      <a href="https://github.com/Oko300/FlowDev">GitHub</a> &middot;
      <a href="https://x.com/success_o1">@success_o1</a>
    </div>
  </div>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard  —  shown after GitHub OAuth succeeds
// Token is passed in the URL fragment (never hits server logs)
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get('/dashboard', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>FlowDev — Dashboard</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><polygon points='14,2 7,13 11.5,13 9.5,22 17,11 12,11' fill='%236366f1'/></svg>">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:32px 24px}
    .wrap{max-width:600px;margin:0 auto}
    .header{display:flex;align-items:center;gap:16px;margin-bottom:32px}
    .avatar{width:52px;height:52px;border-radius:50%;border:2px solid #30363d}
    .greeting{font-size:20px;font-weight:700}
    .greeting span{color:#6366f1}
    .sub{color:#8b949e;font-size:13px;margin-top:2px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px;margin-bottom:20px}
    .card h3{font-size:13px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
    .code-box{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px 14px;font-family:monospace;font-size:13px;word-break:break-all;color:#60a5fa;line-height:1.5;position:relative}
    .copy-btn{position:absolute;top:8px;right:8px;background:#6366f1;color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer}
    .copy-btn:hover{background:#5558e3}
    .steps{counter-reset:steps}
    .step{display:flex;gap:12px;margin-bottom:16px;font-size:13px}
    .step-n{width:24px;height:24px;border-radius:50%;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
    .step-t{padding-top:2px;line-height:1.6;color:#8b949e}
    .step-t strong{color:#e6edf3}
    .badge{display:inline-flex;align-items:center;gap:6px;background:#14532d;color:#4ade80;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px}
    .toast{position:fixed;top:20px;right:20px;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;display:none}
    a{color:#6366f1}
  </style>
</head>
<body>
  <div class="toast" id="toast">Copied!</div>
  <div class="wrap">
    <div class="header">
      <img class="avatar" id="avatar" src="" alt="">
      <div>
        <div class="greeting">Welcome back, <span id="uname">...</span></div>
        <div class="sub">Your FlowDev workspace is ready</div>
      </div>
    </div>

    <div class="badge">&#10003; Active Token</div>

    <div class="card">
      <h3>Your Access Token</h3>
      <div class="code-box" id="token-box">
        <span id="token-val">Loading...</span>
        <button class="copy-btn" onclick="copyToken()">Copy</button>
      </div>
      <p style="font-size:11px;color:#484f58;margin-top:8px">Paste this into the FlowDev sidebar in VS Code to connect.</p>
    </div>

    <div class="card">
      <h3>Your MCP Connector URL</h3>
      <div class="code-box" id="mcp-box">
        <span id="mcp-val">Loading...</span>
        <button class="copy-btn" onclick="copyMcp()">Copy</button>
      </div>
      <p style="font-size:11px;color:#484f58;margin-top:8px">Add this in Claude.ai &rarr; Settings &rarr; Connectors &rarr; Add Custom Connector &rarr; select "No sign-in".</p>
    </div>

    <div class="card">
      <h3>Quick Setup (3 steps)</h3>
      <div class="steps">
        <div class="step">
          <div class="step-n">1</div>
          <div class="step-t">Install the <strong>FlowDev MCP</strong> extension in VS Code &rarr; <a href="https://marketplace.visualstudio.com/items?itemName=successO.flowdevmcp" target="_blank">Open Marketplace</a></div>
        </div>
        <div class="step">
          <div class="step-n">2</div>
          <div class="step-t">Click the <strong>FlowDev &#9889; icon</strong> in VS Code Activity Bar &rarr; paste your token &rarr; click Connect. The sidebar will show your MCP URL.</div>
        </div>
        <div class="step">
          <div class="step-n">3</div>
          <div class="step-t">In <strong>Claude.ai</strong> go to Settings &rarr; Connectors &rarr; Add Custom Connector &rarr; paste the MCP URL &rarr; select <strong>"No sign-in"</strong> &rarr; Connect.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    var BASE = window.location.origin;
    var fragment = window.location.hash.substring(1);
    var params = {};
    fragment.split('&').forEach(function(p) {
      var parts = p.split('=');
      params[parts[0]] = decodeURIComponent(parts.slice(1).join('='));
    });

    var token = params.token || '';
    var user  = params.user  || 'there';
    var name  = params.name  || user;
    var avatar = params.avatar || '';

    document.getElementById('uname').textContent = name;
    if (avatar) document.getElementById('avatar').src = avatar;
    document.getElementById('token-val').textContent = token || 'Token not found — try signing in again.';
    document.getElementById('mcp-val').textContent   = token ? BASE + '/mcp?token=' + token : 'N/A';

    // Clear the fragment from the address bar (token not stored in browser history)
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '/dashboard');
    }

    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(function() { t.style.display = 'none'; }, 2000);
    }

    function copyToken() {
      navigator.clipboard.writeText(token).then(function() { showToast('Token copied!'); });
    }

    function copyMcp() {
      var url = BASE + '/mcp?token=' + token;
      navigator.clipboard.writeText(url).then(function() { showToast('MCP URL copied!'); });
    }
  </script>
</body>
</html>`);
});
