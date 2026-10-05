import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

export const adminRouter = express.Router();

const DATA_FILE = path.join(__dirname, '../../data/users.json');

// Make sure data folder exists
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ requests: [], users: [] }, null, 2));
}

function readData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data: any) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Send email notification
async function sendEmail(to: string, subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  await transporter.verify();
  await transporter.sendMail({
    from: `"FlowDev" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

// ── PUBLIC: Request access page ──────────
adminRouter.get('/request', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Request Access — FlowDev</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; padding: 40px; max-width: 480px; width: 100%; }
    .logo { font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .logo span { color: #6366f1; }
    .tagline { color: #888; font-size: 14px; margin-bottom: 32px; }
    label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; font-weight: 500; }
    input, textarea, select { width: 100%; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 10px 14px; color: #e5e5e5; font-size: 14px; margin-bottom: 16px; outline: none; transition: border-color 0.2s; font-family: inherit; }
    input:focus, textarea:focus, select:focus { border-color: #6366f1; }
    textarea { resize: vertical; min-height: 80px; }
    button { width: 100%; background: #6366f1; color: white; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #5558e3; }
    .social { margin-top: 28px; padding-top: 24px; border-top: 1px solid #1f1f1f; text-align: center; }
    .social p { color: #666; font-size: 13px; margin-bottom: 12px; }
    .social-links { display: flex; gap: 12px; justify-content: center; }
    .social-links a { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid #2a2a2a; border-radius: 8px; color: #aaa; text-decoration: none; font-size: 13px; transition: all 0.2s; }
    .social-links a:hover { border-color: #6366f1; color: #fff; }
    .success { background: #0f2e1a; border: 1px solid #16a34a; border-radius: 8px; padding: 16px; color: #4ade80; display: none; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Flow<span>Dev</span></div>
    <p class="tagline">AI-powered coding assistant — request access below</p>
    <div class="success" id="success">✅ Request submitted! You'll hear back soon via email.</div>
    <div id="error-msg" style="background:#2e1111;border:1px solid #dc2626;border-radius:8px;padding:12px 16px;color:#f87171;display:none;margin-bottom:16px;font-size:14px"></div>
    <form id="form">
      <label>Full Name</label>
      <input type="text" name="name" placeholder="Your name" required>
      <label>Email Address</label>
      <input type="email" name="email" placeholder="you@example.com" pattern="[^\s@]+@[^\s@]+\.[^\s@]+" required>
      <label>What do you want to build?</label>
      <textarea name="reason" placeholder="Tell me what you're working on..." required></textarea>
      <label>Preferred contact</label>
      <select name="contactMethod">
        <option value="email">Email</option>
        <option value="x">X (Twitter)</option>
        <option value="linkedin">LinkedIn</option>
      </select>
      <input type="text" name="contactHandle" placeholder="Your X handle or LinkedIn URL (optional)">
      <button type="submit">Request Access →</button>
    </form>
    <div class="social">
      <p>Or reach me directly:</p>
      <div class="social-links">
        <a href="https://x.com/success_o1" target="_blank">𝕏 @success_o1</a>
        <a href="https://www.linkedin.com/in/success-o-1376b1344" target="_blank">in LinkedIn</a>
      </div>
    </div>
  </div>
  <script>
    const form = document.getElementById('form');
    const btn = form.querySelector('button');
    const success = document.getElementById('success');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.textContent = 'Sending...';
      btn.disabled = true;
      btn.style.opacity = '0.7';

      try {
        const data = Object.fromEntries(new FormData(e.target));
        const res = await fetch('/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        const result = await res.json();
        if (res.ok && result.success) {
          success.style.display = 'block';
          form.style.display = 'none';
        } else {
          const errorMsg = result.error || 'Something went wrong. Please try again.';
          btn.textContent = 'Request Access →';
          btn.disabled = false;
          btn.style.opacity = '1';
          const errorDiv = document.getElementById('error-msg');
          errorDiv.textContent = errorMsg;
          errorDiv.style.display = 'block';
        }
      } catch (err) {
        btn.textContent = 'Request Access →';
        btn.disabled = false;
        btn.style.opacity = '1';
        alert('Something went wrong. Please try again.');
      }
    });
  </script>
</body>
</html>
  `);
});

// ── PUBLIC: Submit request ────────────────
adminRouter.post('/request', async (req, res) => {
  const { name, email, reason, contactMethod, contactHandle } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    return;
  }

  const data = readData();

  const alreadyExists = data.requests.some(
    (r: any) => r.email === email && (r.status === 'pending' || r.status === 'approved')
  );
  if (alreadyExists) {
    res.json({ success: true, duplicate: true });
    return;
  }

  const request = {
    id: crypto.randomUUID(),
    name,
    email,
    reason,
    contactMethod,
    contactHandle,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  data.requests.push(request);
  writeData(data);
  res.json({ success: true }); // respond immediately

  // send email in background - do not await before responding
  try {
    await sendEmail(
      process.env.ADMIN_EMAIL!,
      `🔔 New FlowDev access request from ${name}`,
      `
        <h2>New Access Request</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Wants to build:</strong> ${reason}</p>
        <p><strong>Contact:</strong> ${contactMethod} — ${contactHandle || 'not provided'}</p>
        <br>
        <a href="${process.env.PUBLIC_URL}/admin" style="background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;">
          Review in Admin Dashboard →
        </a>
      `
    );
  } catch (e: any) {
    console.error('Admin notification email failed:', e.message);
  }
});

// ── ADMIN: Dashboard ──────────────────────
adminRouter.get('/admin', (req, res) => {
  const adminKey = req.query.key;
  if (adminKey !== process.env.ADMIN_KEY) {
    res.status(401).send('<h2 style="font-family:sans-serif;color:red;padding:40px">❌ Unauthorized. Add ?key=YOUR_ADMIN_KEY to the URL</h2>');
    return;
  }
  const data = readData();
  const pendingRows = data.requests.filter((r: any) => r.status === 'pending').map((r: any) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.email}</td>
      <td>${r.reason}</td>
      <td>${r.contactMethod}: ${r.contactHandle || '-'}</td>
      <td>${new Date(r.createdAt).toLocaleDateString()}</td>
      <td>
        <button onclick="approve('${r.id}', this)" style="background:#16a34a;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;margin-right:6px">Approve</button>
        <button onclick="deny('${r.id}', this)" style="background:#dc2626;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer">Deny</button>
      </td>
    </tr>
  `).join('');

  const approvedRows = data.users.map((u: any) => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td><code style="background:#1a1a1a;padding:2px 6px;border-radius:4px;font-size:12px">${u.token.slice(0,16)}...</code></td>
      <td>${new Date(u.approvedAt).toLocaleDateString()}</td>
      <td><button onclick="revoke('${u.id}', this)" style="background:#7c3aed;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer">Revoke</button></td>
    </tr>
  `).join('');

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FlowDev Admin</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0a0a0a; color:#e5e5e5; padding:40px; }
    h1 { font-size:24px; margin-bottom:4px; } h1 span { color:#6366f1; }
    .sub { color:#666; font-size:14px; margin-bottom:32px; }
    h2 { font-size:16px; color:#aaa; margin-bottom:16px; }
    .section { background:#111; border:1px solid #222; border-radius:12px; padding:24px; margin-bottom:24px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th { text-align:left; color:#666; font-size:12px; font-weight:600; padding-bottom:12px; border-bottom:1px solid #1f1f1f; }
    td { padding:12px 0; border-bottom:1px solid #1a1a1a; vertical-align:top; padding-right:16px; }
    .empty { color:#444; font-style:italic; padding:16px 0; }
    .stats { display:flex; gap:16px; margin-bottom:24px; }
    .stat { background:#111; border:1px solid #222; border-radius:10px; padding:16px 24px; }
    .stat-num { font-size:28px; font-weight:700; color:#6366f1; }
    .stat-label { font-size:12px; color:#666; margin-top:2px; }
  </style>
</head>
<body>
  <h1>Flow<span>Dev</span> Admin</h1>
  <p class="sub">Manage access requests and approved users</p>
  <div class="stats">
    <div class="stat"><div class="stat-num">${data.requests.filter((r:any)=>r.status==='pending').length}</div><div class="stat-label">Pending Requests</div></div>
    <div class="stat"><div class="stat-num">${data.users.length}</div><div class="stat-label">Active Users</div></div>
    <div class="stat"><div class="stat-num">${data.requests.filter((r:any)=>r.status==='denied').length}</div><div class="stat-label">Denied</div></div>
  </div>
  <div class="section">
    <h2>⏳ Pending Requests</h2>
    ${pendingRows ? `<table><tr><th>Name</th><th>Email</th><th>Wants to build</th><th>Contact</th><th>Date</th><th>Action</th></tr>${pendingRows}</table>` : '<p class="empty">No pending requests</p>'}
  </div>
  <div class="section">
    <h2>✅ Approved Users</h2>
    ${approvedRows ? `<table><tr><th>Name</th><th>Email</th><th>Token</th><th>Approved</th><th>Action</th></tr>${approvedRows}</table>` : '<p class="empty">No approved users yet</p>'}
  </div>
  <script>
    const key = new URLSearchParams(location.search).get('key');

    function setLoading(btn, text) {
      btn.textContent = text;
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }

    async function approve(id, btn) {
      setLoading(btn, 'Approving...');
      try {
        const res = await fetch('/admin/approve/' + id + '?key=' + key, { method: 'POST' });
        if (res.ok) {
          location.reload();
        } else {
          alert('Approve failed. Check server logs.');
          location.reload();
        }
      } catch (err) {
        alert('Network error. Try again.');
        location.reload();
      }
    }

    async function deny(id, btn) {
      setLoading(btn, 'Denying...');
      try {
        const res = await fetch('/admin/deny/' + id + '?key=' + key, { method: 'POST' });
        if (res.ok) {
          location.reload();
        } else {
          alert('Deny failed.');
          location.reload();
        }
      } catch (err) {
        alert('Network error. Try again.');
        location.reload();
      }
    }

    async function revoke(id, btn) {
      if (!confirm('Revoke this user token? They will lose access immediately.')) return;
      setLoading(btn, 'Revoking...');
      try {
        const res = await fetch('/admin/revoke/' + id + '?key=' + key, { method: 'POST' });
        if (res.ok) {
          location.reload();
        } else {
          alert('Revoke failed.');
          location.reload();
        }
      } catch (err) {
        alert('Network error. Try again.');
        location.reload();
      }
    }
  </script>
</body>
</html>
  `);
});

// ── ADMIN: Approve request ────────────────
adminRouter.post('/admin/approve/:id', async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const data = readData();
  const request = data.requests.find((r: any) => r.id === req.params.id);
  if (!request) { res.status(404).json({ error: 'Not found' }); return; }
  request.status = 'approved';
  const token = generateToken();
  const user = {
    id: crypto.randomUUID(),
    requestId: request.id,
    name: request.name,
    email: request.email,
    token,
    approvedAt: new Date().toISOString(),
    active: true,
  };
  data.users.push(user);
  writeData(data);
  res.json({ success: true, token });

  // Email the user their token
  try {
    console.log('Sending approval email to:', request.email, 'via SMTP user:', process.env.SMTP_USER);
    await sendEmail(
      request.email,
      '✅ Your FlowDev access is approved!',
      `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#111">Welcome to FlowDev, ${request.name}!</h2>
  <p style="color:#444">Your access has been approved. Here is everything you need to get connected.</p>
  
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  
  <h3 style="color:#111">Step 1 — Install the VS Code Extension</h3>
  <p style="color:#444">Open VS Code, go to Extensions, search <strong>FlowDev MCP</strong> and install it.</p>
  <p style="color:#444">Or install directly from: <a href="https://marketplace.visualstudio.com/items?itemName=successo.flowdevmcp">VS Code Marketplace</a></p>

  <h3 style="color:#111;margin-top:24px">Step 2 — Enter Your Token in VS Code</h3>
  <p style="color:#444">Click the FlowDev icon in the bottom-left status bar and select <strong>Enter Token</strong>. Paste your token below:</p>
  <code style="background:#f3f4f6;padding:12px 16px;display:block;border-radius:8px;margin:12px 0;font-size:13px;word-break:break-all;color:#111">${token}</code>

  <h3 style="color:#111;margin-top:24px">Step 3 — Add the MCP Connector in Your AI App</h3>
  <p style="color:#444">In Claude.ai go to Settings then Connectors then Add Custom Connector and paste this URL:</p>
  <code style="background:#f3f4f6;padding:12px 16px;display:block;border-radius:8px;margin:12px 0;font-size:13px;word-break:break-all;color:#111">https://flowdev.onrender.com/mcp?token=${token}</code>
  <p style="color:#666;font-size:13px">Works with any MCP-compatible AI: Claude, Grok, GPT-4, Gemini and more.</p>

  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">

  <p style="color:#888;font-size:13px">Keep your token private. Need help? Reach out on <a href="https://x.com/success_o1">X @success_o1</a></p>
</div>
`
    );
    console.log('Approval email sent successfully to:', request.email);
  } catch (e: any) {
    console.error('Approval email failed:', e.message);
  }
});

// ── ADMIN: Deny request ───────────────────
adminRouter.post('/admin/deny/:id', (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const data = readData();
  const request = data.requests.find((r: any) => r.id === req.params.id);
  if (request) request.status = 'denied';
  writeData(data);
  res.json({ success: true });
});

// ── ADMIN: Revoke user ────────────────────
adminRouter.post('/admin/revoke/:id', (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const data = readData();
  const user = data.users.find((u: any) => u.id === req.params.id);
  if (user) user.active = false;
  writeData(data);
  res.json({ success: true });
});

// ── Token validation export ───────────────
export function validateToken(token: string): boolean {
  try {
    const data = readData();
    return data.users.some((u: any) => u.token === token && u.active === true);
  } catch {
    return false;
  }
}
