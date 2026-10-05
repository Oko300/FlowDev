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
    <form id="form">
      <label>Full Name</label>
      <input type="text" name="name" placeholder="Your name" required>
      <label>Email Address</label>
      <input type="email" name="email" placeholder="you@example.com" required>
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
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const res = await fetch('/request', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      if (res.ok) {
        document.getElementById('success').style.display = 'block';
        e.target.reset();
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

  // Notify admin by email
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

  res.json({ success: true });
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
        <button onclick="approve('${r.id}')" style="background:#16a34a;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;margin-right:6px">Approve</button>
        <button onclick="deny('${r.id}')" style="background:#dc2626;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer">Deny</button>
      </td>
    </tr>
  `).join('');

  const approvedRows = data.users.map((u: any) => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td><code style="background:#1a1a1a;padding:2px 6px;border-radius:4px;font-size:12px">${u.token.slice(0,16)}...</code></td>
      <td>${new Date(u.approvedAt).toLocaleDateString()}</td>
      <td><button onclick="revoke('${u.id}')" style="background:#7c3aed;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer">Revoke</button></td>
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
    async function approve(id) {
      await fetch('/admin/approve/' + id + '?key=' + key, {method:'POST'});
      location.reload();
    }
    async function deny(id) {
      await fetch('/admin/deny/' + id + '?key=' + key, {method:'POST'});
      location.reload();
    }
    async function revoke(id) {
      if(confirm('Revoke this user token?')) {
        await fetch('/admin/revoke/' + id + '?key=' + key, {method:'POST'});
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

  // Email the user their token
  try {
    await sendEmail(
      request.email,
      '✅ Your FlowDev access is approved!',
      `
        <h2>Welcome to FlowDev, ${request.name}!</h2>
        <p>Your access has been approved. Here is how to connect:</p>
        <br>
        <p><strong>Step 1:</strong> Go to Claude.ai → Settings → Connectors → Add</p>
        <p><strong>Step 2:</strong> Paste this URL:</p>
        <code style="background:#f3f4f6;padding:12px;display:block;border-radius:8px;margin:12px 0;font-size:14px">
          ${process.env.PUBLIC_URL}/mcp?token=${token}
        </code>
        <p><strong>Step 3:</strong> Name it "FlowDev" and connect</p>
        <br>
        <p>Keep your token private — it gives access to your coding workspace.</p>
        <br>
        <p>Need help? Reach me on <a href="https://x.com/success_o1">X @success_o1</a></p>
      `
    );
  } catch (e: any) {
    console.error('Approval email failed:', e.message);
  }
  res.json({ success: true, token });
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
