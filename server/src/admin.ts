import express from 'express';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
// Email via Brevo HTTPS API — works on Render free tier (no SMTP blocking)

const sql = neon(process.env.DATABASE_URL!);
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'FlowDev', email: process.env.SMTP_USER },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err));
  }
}
const ADMIN_KEY = process.env.ADMIN_KEY || 'flowdev-admin-2024-secret';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'spidy9058@gmail.com';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://flowdev.onrender.com';

// ── In-memory token cache keeps validateToken() synchronous ───────────────
const approvedTokens = new Set<string>();

export async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS fd_users (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      email     TEXT NOT NULL,
      reason    TEXT,
      status    TEXT NOT NULL DEFAULT 'pending',
      token     TEXT,
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      approved_at  TIMESTAMPTZ
    )
  `;
  const rows = await sql`
    SELECT token FROM fd_users WHERE status = 'approved' AND token IS NOT NULL
  `;
  rows.forEach((r: any) => { if (r.token) approvedTokens.add(r.token); });
  console.log(`✅ DB ready — ${approvedTokens.size} active token(s) loaded`);
}

export function validateToken(token: string): boolean {
  return approvedTokens.has(token);
}

export const adminRouter = express.Router();

// ── Request form ───────────────────────────────────────────────────────────
adminRouter.get('/request', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Request FlowDev Access</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><polygon points='14,2 7,13 11.5,13 9.5,22 17,11 12,11' fill='%236366f1'/></svg>">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;max-width:480px;width:100%}
    .logo{font-size:24px;font-weight:700;margin-bottom:4px}.logo span{color:#6366f1}
    .sub{color:#8b949e;font-size:14px;margin-bottom:32px}
    h2{font-size:18px;margin-bottom:24px}
    label{display:block;font-size:13px;color:#8b949e;margin-bottom:6px;font-weight:500}
    input,textarea{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px 14px;color:#e6edf3;font-size:14px;margin-bottom:16px;font-family:inherit;outline:none}
    input:focus,textarea:focus{border-color:#6366f1}
    textarea{height:80px;resize:vertical}
    button{width:100%;background:#6366f1;color:white;border:none;padding:12px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer}
    button:hover{background:#5558e3}
    .msg{padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px;display:none}
    .ok{background:#14532d;color:#4ade80;border:1px solid #166534}
    .err{background:#3b1515;color:#f87171;border:1px solid #7f1d1d}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Flow<span>Dev</span></div>
    <p class="sub">AI coding assistant bridge for VS Code</p>
    <h2>Request Free Access</h2>
    <div class="msg ok" id="ok">✅ Request submitted! You will hear back within 24 hours.</div>
    <div class="msg err" id="err"></div>
    <form id="f">
      <label>Your Name</label>
      <input type="text" name="name" placeholder="John Doe" required />
      <label>Email Address</label>
      <input type="email" name="email" placeholder="you@example.com" required />
      <label>What are you building?</label>
      <textarea name="reason" placeholder="Briefly describe your project..."></textarea>
      <button type="submit" id="btn">Submit Request</button>
    </form>
  <hr style="border:none;border-top:1px solid #21262d;margin:24px 0 16px">
  <div style="display:flex;justify-content:center;gap:20px;align-items:center">
    <a href="https://x.com/success_o1" target="_blank" style="color:#6366f1;font-size:12px;text-decoration:none">𝕏 Twitter</a>
    <a href="https://www.linkedin.com/in/success-o-1376b1344" target="_blank" style="color:#6366f1;font-size:12px;text-decoration:none">LinkedIn</a>
    <a href="https://github.com/Oko300/FlowDev" target="_blank" style="color:#6366f1;font-size:12px;text-decoration:none">GitHub</a>
  </div>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('btn');
      btn.textContent = 'Sending...'; btn.disabled = true;
      const data = Object.fromEntries(new FormData(e.target));
      try {
        const r = await fetch('/api/request', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
        const j = await r.json();
        if (r.ok) { document.getElementById('f').style.display='none'; document.getElementById('ok').style.display='block'; }
        else { const el=document.getElementById('err'); el.textContent=j.error; el.style.display='block'; btn.textContent='Submit Request'; btn.disabled=false; }
      } catch { const el=document.getElementById('err'); el.textContent='Network error. Try again.'; el.style.display='block'; btn.textContent='Submit Request'; btn.disabled=false; }
    });
  </script>
</body>
</html>`);
});


// ── Submit request ─────────────────────────────────────────────────────────
adminRouter.post('/api/request', async (req, res) => {
  const { name, email, reason } = req.body;
  if (!name || !email || !email.includes('@')) {
    res.status(400).json({ error: 'Name and a valid email are required.' });
    return;
  }

  // One active token per email — block duplicate requests
  const existing = await sql`
    SELECT status FROM fd_users
    WHERE LOWER(email) = LOWER(${email}) AND status IN ('pending','approved')
    LIMIT 1
  `;
  if (existing.length > 0) {
    const s = existing[0].status;
    res.status(400).json({
      error: s === 'approved'
        ? 'This email already has an active token. Check your approval email, or ask the admin to revoke it first.'
        : 'A request from this email is already pending. Please wait for a response.'
    });
    return;
  }

  await sql`INSERT INTO fd_users (name, email, reason) VALUES (${name}, ${email}, ${reason || ''})`;
  res.json({ success: true });

  try {
    await sendEmail(ADMIN_EMAIL, `FlowDev: New request from ${name}`, `<h2>New Access Request</h2><p><b>Name:</b> ${name}</p><p><b>Email:</b> ${email}</p><p><b>Reason:</b> ${reason || 'Not provided'}</p><p><a href="${PUBLIC_URL}/admin?key=${ADMIN_KEY}" style="background:#6366f1;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:16px">Open Admin Dashboard</a></p>`)
  } catch (err: any) { console.error('Admin email failed:', err.message); }
});

// ── Admin dashboard ────────────────────────────────────────────────────────
adminRouter.get('/admin', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) { res.status(401).send('Unauthorized'); return; }
  const users = await sql`SELECT * FROM fd_users ORDER BY requested_at DESC`;
  const PUBLIC = process.env.PUBLIC_URL || 'https://flowdev.onrender.com';

  // Attach mcpUrl to each user for client-side rendering
  const usersData = users.map((u: any) => ({
    ...u,
    mcpUrl: u.token ? PUBLIC + '/mcp?token=' + u.token : '',
    requested_at: new Date(u.requested_at).toLocaleDateString()
  }));

  const total    = users.length;
  const approved = users.filter((u: any) => u.status === 'approved').length;
  const pending  = users.filter((u: any) => u.status === 'pending').length;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>FlowDev Admin</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:24px}
    h1{font-size:22px;margin-bottom:4px} h1 span{color:#6366f1}
    .meta{color:#8b949e;font-size:13px;margin-bottom:24px}
    .meta a{color:#6366f1;text-decoration:none}
    .toast{position:fixed;top:20px;right:20px;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;display:none;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,.4)}
    table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}
    th{background:#21262d;padding:10px 16px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #30363d}
    td{padding:10px 16px;border-bottom:1px solid #21262d;font-size:13px;vertical-align:top}
    .msg-box{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:14px;margin-top:6px;font-size:12px;color:#c9d1d9;white-space:pre-wrap;line-height:1.7;word-break:break-word}
    .btn{border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600}
    .btn-green{background:#16a34a;color:#fff}
    .btn-red{background:#dc2626;color:#fff}
    .btn-revoke{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
    .btn-copy{background:none;border:1px solid #30363d;color:#8b949e;padding:2px 8px;font-size:11px;border-radius:4px;cursor:pointer}
    .btn-copy-msg{background:#6366f1;color:#fff;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;border:none}
    .badge{padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .badge-approved{background:#14532d;color:#4ade80}
    .badge-revoked{background:#3b1515;color:#f87171}
    .badge-pending{background:#1c2a4a;color:#60a5fa}
    .msg-row td{padding:0 16px 14px 16px;border-bottom:1px solid #21262d}
    .msg-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .msg-label{font-size:11px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:.5px}
  </style>
</head>
<body>
  <div class="toast" id="toast">✅ Copied!</div>
  <h1>Flow<span>Dev</span> Admin</h1>
  <p class="meta">
    Total: ${total} &nbsp;|&nbsp;
    Approved: ${approved} &nbsp;|&nbsp;
    Pending: ${pending} &nbsp;|&nbsp;
    <a href="/request">Request page</a>
  </p>
  <table id="tbl">
    <thead>
      <tr>
        <th>Name</th><th>Email</th><th>Reason</th>
        <th>Status</th><th>Date</th><th>Action</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

  <script>
    const ADMIN_KEY = '${ADMIN_KEY}';
    const PUBLIC    = '${PUBLIC}';
    const users     = ${JSON.stringify(usersData)};

    function toast() {
      const t = document.getElementById('toast');
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 2000);
    }

    function cp(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        toast();
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = orig, 2000);
      });
    }

    function buildMessage(u) {
      return [
        'Hi ' + u.name + ',',
        '',
        'Your FlowDev access has been approved! ⚡',
        '',
        'Your Token:',
        u.token,
        '',
        'Setup (3 steps):',
        '1. Install the VS Code extension:',
        '   https://marketplace.visualstudio.com/items?itemName=successO.flowdevmcp',
        '',
        '2. Click the FlowDev ⚡ icon in VS Code Activity Bar (left sidebar),',
        '   paste your token and click Connect.',
        '',
        '3. Once connected, the FlowDev sidebar shows your MCP URL.',
        '   Copy it, then go to Claude.ai → Settings → Connectors →',
        '   Add Custom Connector → paste URL → select "No sign-in" → Connect.',
        '',
        'Need help? DM me on X: https://x.com/success_o1',
        '',
        '— FlowDev'
      ].join('\n');
    }

    async function go(id, type, btn) {
      btn.textContent = '...'; btn.disabled = true;
      const r = await fetch('/api/admin/' + type, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
        body: JSON.stringify({ id })
      });
      const j = await r.json();
      if (j.success) {
        setTimeout(() => location.reload(), 300);
      } else {
        alert(j.error || 'Something went wrong');
        btn.textContent = type; btn.disabled = false;
      }
    }

    function render() {
      const tbody = document.getElementById('tbody');
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;padding:48px">No requests yet</td></tr>';
        return;
      }
      users.forEach(u => {
        // Main row
        const tr = document.createElement('tr');
        const badgeClass = 'badge badge-' + (u.status === 'approved' ? 'approved' : u.status === 'revoked' ? 'revoked' : 'pending');

        let actionHTML = '-';
        if (u.status === 'pending') {
          actionHTML = '<button class="btn btn-green" onclick="go(' + u.id + ',\'approve\',this)" style="margin-right:4px">Approve</button>' +
                       '<button class="btn btn-red" onclick="go(' + u.id + ',\'deny\',this)">Deny</button>';
        } else if (u.status === 'approved') {
          actionHTML = '<button class="btn btn-revoke" onclick="go(' + u.id + ',\'revoke\',this)">Revoke</button>';
        }

        tr.innerHTML =
          '<td style="font-weight:500">' + u.name + '</td>' +
          '<td>' + u.email + ' <button class="btn-copy" onclick="cp(\'' + u.email + '\',this)">Copy</button></td>' +
          '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b949e">' + (u.reason || '-') + '</td>' +
          '<td><span class="' + badgeClass + '">' + u.status + '</span></td>' +
          '<td style="color:#8b949e;font-size:11px">' + u.requested_at + '</td>' +
          '<td>' + actionHTML + '</td>';
        tbody.appendChild(tr);

        // Message row for approved users only
        if (u.status === 'approved' && u.token) {
          const msg = buildMessage(u);
          const msgTr = document.createElement('tr');
          msgTr.className = 'msg-row';
          const msgTd = document.createElement('td');
          msgTd.colSpan = 6;
          msgTd.innerHTML =
            '<div class="msg-header">' +
              '<span class="msg-label">📋 Send this message to ' + u.email + ' manually</span>' +
              '<button class="btn-copy-msg" onclick="cp(this.dataset.msg,this)" data-msg="">Copy Message</button>' +
            '</div>' +
            '<div class="msg-box">' + msg.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>';
          // Set msg on button via dataset to avoid quote escaping
          msgTd.querySelector('.btn-copy-msg').dataset.msg = msg;
          msgTr.appendChild(msgTd);
          tbody.appendChild(msgTr);
        }
      });
    }

    render();
  </script>
</body>
</html>`);
});

// ── Approve ────────────────────────────────────────────────────────────────
adminRouter.post('/api/admin/approve', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const token = crypto.randomBytes(32).toString('hex');
  const rows = await sql`
    UPDATE fd_users SET status='approved', token=${token}, approved_at=NOW()
    WHERE id=${req.body.id} AND status='pending'
    RETURNING name, email
  `;
  if (rows.length === 0) { res.status(404).json({ error: 'Not found or already processed' }); return; }
  approvedTokens.add(token);
  const { name, email } = rows[0];
  const mcpUrl = `${PUBLIC_URL}/mcp?token=${token}`;
  // Send email before responding so failures surface to admin
  let emailErr = null;
  try {
    const result = await sendEmail(email, 'Your FlowDev access is approved ✅', `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:40px">
      <h2 style="margin:0 0 4px 0;font-size:22px;font-weight:700">Welcome to FlowDev, ${name}! <span style="color:#6366f1">⚡</span></h2>
      <p style="color:#666;margin:0 0 32px 0;font-size:14px">Your access has been approved. Three steps and you are live.</p>

      <h3 style="font-size:15px;margin:0 0 8px 0">Step 1 — Install the VS Code Extension</h3>
      <p style="color:#555;font-size:14px;margin:0 0 6px 0">Search <strong>FlowDev MCP</strong> in the VS Code Extensions panel and install it.</p>
      <a href="https://marketplace.visualstudio.com/items?itemName=successO.flowdevmcp" style="color:#6366f1;font-size:13px">Open in VS Code Marketplace →</a>

      <h3 style="font-size:15px;margin:28px 0 8px 0">Step 2 — Paste Your Token in VS Code</h3>
      <p style="color:#555;font-size:14px;margin:0 0 12px 0">Click the <strong>FlowDev ⚡ icon</strong> in the Activity Bar on the left side of VS Code. Paste your token below and click <strong>Connect</strong>.</p>
      <div style="background:#f4f4f8;border-radius:6px;padding:14px 16px;font-family:monospace;font-size:13px;word-break:break-all;color:#1a1a2e;border:1px solid #e0e0e0">${token}</div>
      <p style="color:#e05a00;font-size:12px;margin:8px 0 28px 0">⚠️ Keep this token private — it is tied to your email only.</p>

      <h3 style="font-size:15px;margin:0 0 8px 0">Step 3 — Connect to Your AI</h3>
      <p style="color:#555;font-size:14px;margin:0 0 8px 0">Once your token is pasted and VS Code shows <strong>Connected</strong>, the FlowDev sidebar will display your personal MCP URL. <strong>Copy it from there.</strong></p>
      <p style="color:#555;font-size:14px;margin:0 0 8px 0">Then in <strong>Claude.ai</strong> go to <strong>Settings → Connectors → Add Custom Connector</strong>, paste the URL, choose <strong>"No sign-in"</strong>, and click Connect.</p>
      <p style="color:#555;font-size:14px;margin:0">Works with Claude, Cursor, Windsurf, Cline, Continue and any MCP-compatible AI.</p>

      <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
      <p style="color:#aaa;font-size:12px;margin:0">Need help? <a href="https://x.com/success_o1" style="color:#6366f1">@success_o1 on X</a> · <a href="https://github.com/Oko300/FlowDev" style="color:#6366f1">GitHub</a></p>
    </div>
  `)
  } catch (err) {
    emailErr = err.message + ' | ' + JSON.stringify(err);
    console.error('Approval email exception:', emailErr);
  }
  res.json({ success: true, emailSent: !emailErr, emailError: emailErr || undefined });
});

// ── Deny ───────────────────────────────────────────────────────────────────
adminRouter.post('/api/admin/deny', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  await sql`UPDATE fd_users SET status='revoked' WHERE id=${req.body.id} AND status='pending'`;
  res.json({ success: true });
});

// ── Revoke ─────────────────────────────────────────────────────────────────
adminRouter.post('/api/admin/revoke', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const rows = await sql`
    UPDATE fd_users SET status='revoked', token=NULL
    WHERE id=${req.body.id} AND status='approved'
    RETURNING token
  `;
  if (rows.length > 0 && rows[0].token) approvedTokens.delete(rows[0].token);
  res.json({ success: true });
});
