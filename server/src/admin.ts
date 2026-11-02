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

// Called by auth.ts after GitHub OAuth creates a new token — adds it to the cache
export function registerToken(token: string): void {
  approvedTokens.add(token);
}

export const adminRouter = express.Router();

// ── /request now redirects straight to GitHub OAuth login ─────────────────
adminRouter.get('/request', (_req, res) => {
  res.redirect('/login');
});

// ── Admin dashboard (static HTML — zero data embedded) ────────────────────
adminRouter.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_KEY) { res.status(401).send('<h2>Unauthorized</h2>'); return; }
  const key = req.query.key as string;
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>FlowDev Admin</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><polygon points='14,2 7,13 11.5,13 9.5,22 17,11 12,11' fill='%236366f1'/></svg>">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:24px}
    h1{font-size:22px;margin-bottom:4px}h1 span{color:#6366f1}
    .meta{color:#8b949e;font-size:13px;margin-bottom:24px}
    .meta a{color:#6366f1;text-decoration:none}
    .toast{position:fixed;top:20px;right:20px;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;display:none;z-index:999}
    table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}
    th{background:#21262d;padding:10px 16px;text-align:left;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #30363d}
    td{padding:10px 16px;border-bottom:1px solid #21262d;font-size:13px;vertical-align:middle}
    .empty{text-align:center;color:#8b949e;padding:48px}
    .badge{padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .badge-approved{background:#14532d;color:#4ade80}
    .badge-revoked{background:#3b1515;color:#f87171}
    .badge-pending{background:#1c2a4a;color:#60a5fa}
    .btn{border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px}
    .btn-approve{background:#16a34a;color:#fff}
    .btn-deny{background:#dc2626;color:#fff}
    .btn-revoke{background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
    .btn-copy{background:none;border:1px solid #30363d;color:#8b949e;padding:2px 8px;font-size:11px;border-radius:4px;cursor:pointer;margin-left:6px}
    .btn-delete{background:#3b1515;color:#fca5a5;border:1px solid #7f1d1d;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px}
    .btn-delete:hover{background:#5c1a1a}
    .gh-user{display:flex;align-items:center;gap:8px}
    .gh-avatar{width:28px;height:28px;border-radius:50%;border:1px solid #30363d;flex-shrink:0}
    .gh-name{font-size:12px;color:#c9d1d9}
    .gh-link{font-size:11px;color:#6366f1;text-decoration:none}
    .gh-none{color:#484f58;font-size:12px}
    .loading{text-align:center;color:#8b949e;padding:48px;font-size:14px}
    .token-cell{font-family:monospace;font-size:11px;color:#60a5fa;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style>
</head>
<body>
  <div class="toast" id="toast">Copied!</div>
  <h1>Flow<span>Dev</span> Admin</h1>
  <p class="meta" id="meta">Loading...</p>
  <table>
    <thead>
      <tr>
        <th>GitHub</th><th>Name / Email</th><th>Status</th><th>Token</th><th>MCP URL</th><th>Joined</th><th>Action</th>
      </tr>
    </thead>
    <tbody id="tbody"><tr><td colspan="7" class="loading">Loading users...</td></tr></tbody>
  </table>

  <script>
    var ADMIN_KEY = \`${key}\`;

    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg || 'Copied!';
      t.style.display = 'block';
      setTimeout(function() { t.style.display = 'none'; }, 2000);
    }

    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('Copied!');
        var orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(function() { btn.textContent = orig; }, 2000);
      }).catch(function() {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Copied!');
      });
    }

    async function doAction(id, type, btn) {
      btn.disabled = true;
      var orig = btn.textContent;
      btn.textContent = '...';
      try {
        var r = await fetch('/api/admin/' + type, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
          body: JSON.stringify({ id: id })
        });
        var j = await r.json();
        if (j.success) {
          var toasts = { revoke: 'Revoked', delete: 'Deleted' };
          showToast(toasts[type] || 'Done');
          setTimeout(function() { loadUsers(); }, 500);
        } else {
          alert(j.error || 'Something went wrong');
          btn.textContent = orig; btn.disabled = false;
        }
      } catch(e) {
        alert('Network error: ' + e.message);
        btn.textContent = orig; btn.disabled = false;
      }
    }

    function renderRow(u) {
      var tr = document.createElement('tr');

      // GitHub column: avatar + username + link
      var tdGh = document.createElement('td');
      if (u.github_username) {
        var ghDiv = document.createElement('div');
        ghDiv.className = 'gh-user';
        if (u.avatar_url) {
          var img = document.createElement('img');
          img.className = 'gh-avatar';
          img.src = u.avatar_url;
          img.alt = u.github_username;
          ghDiv.appendChild(img);
        }
        var ghInfo = document.createElement('div');
        var ghName = document.createElement('div');
        ghName.className = 'gh-name';
        ghName.textContent = '@' + u.github_username;
        var ghLink = document.createElement('a');
        ghLink.className = 'gh-link';
        ghLink.href = 'https://github.com/' + u.github_username;
        ghLink.target = '_blank';
        ghLink.textContent = 'View profile →';
        ghInfo.appendChild(ghName);
        ghInfo.appendChild(ghLink);
        ghDiv.appendChild(ghInfo);
        tdGh.appendChild(ghDiv);
      } else {
        var noGh = document.createElement('span');
        noGh.className = 'gh-none';
        noGh.textContent = '—';
        tdGh.appendChild(noGh);
      }
      tr.appendChild(tdGh);

      // Name + email
      var tdName = document.createElement('td');
      var nameDiv = document.createElement('div');
      nameDiv.style.fontWeight = '500';
      nameDiv.style.marginBottom = '2px';
      nameDiv.textContent = u.name;
      var emailDiv = document.createElement('div');
      emailDiv.style.cssText = 'font-size:11px;color:#8b949e';
      emailDiv.textContent = u.email;
      tdName.appendChild(nameDiv);
      tdName.appendChild(emailDiv);
      tr.appendChild(tdName);

      // Status badge
      var tdStatus = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'badge badge-' + u.status;
      badge.textContent = u.status;
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // Token (truncated + copy)
      var tdToken = document.createElement('td');
      if (u.token) {
        var tokenSpan = document.createElement('span');
        tokenSpan.className = 'token-cell';
        tokenSpan.title = u.token;
        tokenSpan.textContent = u.token.substring(0, 16) + '...';
        var copyTok = document.createElement('button');
        copyTok.className = 'btn-copy';
        copyTok.textContent = 'Copy';
        (function(tok, btn) {
          btn.addEventListener('click', function() { copyText(tok, btn); });
        })(u.token, copyTok);
        tdToken.appendChild(tokenSpan);
        tdToken.appendChild(copyTok);
      } else {
        tdToken.innerHTML = '<span style="color:#484f58;font-size:12px">—</span>';
      }
      tr.appendChild(tdToken);

      // MCP URL (copy button only — URL is long)
      var tdMcp = document.createElement('td');
      if (u.mcpUrl) {
        var copyMcp = document.createElement('button');
        copyMcp.className = 'btn-copy';
        copyMcp.textContent = 'Copy URL';
        (function(url, btn) {
          btn.addEventListener('click', function() { copyText(url, btn); });
        })(u.mcpUrl, copyMcp);
        tdMcp.appendChild(copyMcp);
      } else {
        tdMcp.innerHTML = '<span style="color:#484f58;font-size:12px">—</span>';
      }
      tr.appendChild(tdMcp);

      // Date joined
      var tdDate = document.createElement('td');
      tdDate.style.cssText = 'color:#8b949e;font-size:11px;white-space:nowrap';
      tdDate.textContent = new Date(u.requested_at).toLocaleDateString();
      tr.appendChild(tdDate);

      // Action buttons — GitHub OAuth users come in as 'approved' already
      var tdAction = document.createElement('td');
      tdAction.style.whiteSpace = 'nowrap';
      if (u.status === 'approved') {
        var revBtn = document.createElement('button');
        revBtn.className = 'btn btn-revoke';
        revBtn.textContent = 'Revoke';
        (function(id, b) {
          b.addEventListener('click', function() { doAction(id, 'revoke', b); });
        })(u.id, revBtn);
        tdAction.appendChild(revBtn);

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-delete';
        delBtn.textContent = 'Delete';
        (function(id, b) {
          b.addEventListener('click', function() {
            if (!confirm('Permanently delete this user and invalidate their token?')) return;
            doAction(id, 'delete', b);
          });
        })(u.id, delBtn);
        tdAction.appendChild(delBtn);
      } else if (u.status === 'revoked') {
        var delBtn2 = document.createElement('button');
        delBtn2.className = 'btn btn-delete';
        delBtn2.textContent = 'Delete';
        (function(id, b) {
          b.addEventListener('click', function() {
            if (!confirm('Permanently delete this revoked entry?')) return;
            doAction(id, 'delete', b);
          });
        })(u.id, delBtn2);
        tdAction.appendChild(delBtn2);
      } else {
        tdAction.innerHTML = '<span style="color:#484f58;font-size:12px">—</span>';
      }
      tr.appendChild(tdAction);

      return tr;
    }

    async function loadUsers() {
      try {
        var r = await fetch('/api/admin/data?key=' + encodeURIComponent(ADMIN_KEY));
        if (!r.ok) {
          document.getElementById('tbody').innerHTML = '<tr><td colspan="7" class="empty">Failed to load: ' + r.status + '</td></tr>';
          return;
        }
        var data = await r.json();
        var users = data.users;
        var tbody = document.getElementById('tbody');
        tbody.innerHTML = '';

        document.getElementById('meta').innerHTML =
          'Total: ' + users.length +
          ' &nbsp;|&nbsp; Approved: ' + users.filter(function(u) { return u.status === 'approved'; }).length +
          ' &nbsp;|&nbsp; Via GitHub: ' + users.filter(function(u) { return !!u.github_username; }).length +
          ' &nbsp;|&nbsp; <a href="/login">Login page</a>';

        if (!users.length) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty">No users yet</td></tr>';
          return;
        }
        users.forEach(function(u) {
          tbody.appendChild(renderRow(u));
        });
      } catch(e) {
        document.getElementById('tbody').innerHTML = '<tr><td colspan="7" class="empty">Error: ' + e.message + '</td></tr>';
      }
    }

    loadUsers();
    // Auto-refresh every 30s so new GitHub sign-ins appear without manual reload
    setInterval(loadUsers, 30000);
  </script>
</body>
</html>`);
});

// ── Admin data API (JSON) — now includes GitHub fields ────────────────────
adminRouter.get('/api/admin/data', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const PUBLIC = process.env.PUBLIC_URL || 'https://flowdev.onrender.com';
  const users = await sql`SELECT * FROM fd_users ORDER BY requested_at DESC`;
  res.json({
    users: users.map((u: any) => ({
      id:              u.id,
      name:            u.name,
      email:           u.email,
      reason:          u.reason || '',
      status:          u.status,
      token:           u.token || '',
      mcpUrl:          u.token ? PUBLIC + '/mcp?token=' + u.token : '',
      github_id:       u.github_id || '',
      github_username: u.github_username || '',
      avatar_url:      u.avatar_url || '',
      requested_at:    u.requested_at,
      approved_at:     u.approved_at || null,
    }))
  });
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

// ── Delete (approved or revoked only) ─────────────────────────────────────
adminRouter.post('/api/admin/delete', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const rows = await sql`
    DELETE FROM fd_users
    WHERE id=${req.body.id} AND status IN ('approved', 'revoked')
    RETURNING token, status
  `;
  if (rows.length === 0) { res.status(404).json({ error: 'Not found or cannot delete pending' }); return; }
  if (rows[0].token) approvedTokens.delete(rows[0].token);
  res.json({ success: true });
});
