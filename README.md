# FlowDev MCP

**A remote MCP server that connects any MCP-compatible AI directly to a developer's VS Code workspace.**

Your AI reads files, writes code, searches your codebase, runs terminal commands, and pushes to GitHub — all from the chat window. No copy-pasting. No tab switching.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/successO.flowdevmcp?label=VS%20Code%20Extension&color=6366f1)](https://marketplace.visualstudio.com/items?itemName=successO.flowdevmcp)

---

## How It Works

```
You chat with your AI  (Claude.ai, Cursor, Windsurf, etc.)
              ↓
  FlowDev MCP Server  (flowdev.onrender.com)
              ↓
  FlowDev VS Code Extension  (on your machine)
              ↓
  Your local files · terminal · GitHub
```

The MCP server is a relay. Your AI sends tool calls to FlowDev, FlowDev forwards them to the VS Code extension via a persistent WebSocket, the extension executes them locally, and results come back to the AI in real time. Your code never leaves your machine.

---

## Getting Access

**Sign in with GitHub — your token is generated instantly. No email, no waiting, no manual approval.**

1. Go to **https://flowdev.onrender.com/login** (or **/request** — both go to the same place)
2. Click **Continue with GitHub**
3. Authorise FlowDev — your personal token is generated immediately
4. Your dashboard shows your token and MCP URL ready to copy

One token per GitHub account. Tokens are permanent until revoked.

---

## MCP Server URL

```
https://flowdev.onrender.com/mcp?token=YOUR_TOKEN
```

Add this as a custom MCP connector in any MCP-compatible AI client.

---

## Setup (3 steps after getting your token)

**Step 1 — Install the VS Code Extension**

Search **FlowDev MCP** in the VS Code Extensions panel, or:
[Open in Marketplace](https://marketplace.visualstudio.com/items?itemName=successO.flowdevmcp)

**Step 2 — Connect in VS Code**

Click the **⚡ FlowDev icon** in the Activity Bar (left sidebar). Paste your token and click **Connect**. The sidebar shows your MCP URL once connected.

**Step 3 — Add the MCP Connector in your AI**

| AI Client | Where to add |
|---|---|
| Claude.ai | Settings → Connectors → Add Custom Connector → paste URL → select **"No sign-in"** → Connect |
| Cursor | Settings → MCP → Add server → paste URL |
| Windsurf | Settings → MCP Servers → Add → paste URL |
| Cline / Continue | MCP Servers config → add URL |

---

## Tools (16 total)

### File Operations
| Tool | Description |
|---|---|
| `read_file` | Read any file in the project |
| `write_file` | Write or create a file (with automatic code quality analysis) |
| `find_and_replace` | Targeted text replacement — safer than rewriting an entire file |
| `delete_file` | Delete a file (workspace-only, cannot touch system files) |
| `rename_file` | Rename or move a file |
| `create_directory` | Create a directory and any missing parents |

### Search
| Tool | Description |
|---|---|
| `search_in_files` | Grep-like search across the entire codebase — returns file, line number, and matching line |

### Terminal
| Tool | Description |
|---|---|
| `run_command` | Run any shell command (`npm install`, `python script.py`, etc.) |

### Navigation
| Tool | Description |
|---|---|
| `list_directory` | List files and folders in a directory |
| `get_project_structure` | Full recursive file tree of the project |

### Git
| Tool | Description |
|---|---|
| `git_status` | Show current git status |
| `git_diff` | Show unstaged or staged changes |
| `git_add` | Stage files for commit |
| `git_commit` | Commit with a message |
| `git_push` | Push to GitHub |

### Status
| Tool | Description |
|---|---|
| `ping` | Verify connection and list available tools |

---

## Example Usage

Once connected, talk to your AI naturally:

```
"Read my package.json and tell me what dependencies are outdated"

"Search for all files that import from ../utils"

"Add input validation to the registration endpoint in src/routes/auth.ts"

"Run the tests and fix whatever is failing"

"Commit everything with a descriptive message and push to main"

"Create a new component at src/components/Card.tsx with basic TypeScript props"
```

---

## Rate Limits

FlowDev applies rate limiting to protect free-tier infrastructure:

| Endpoint | Limit |
|---|---|
| `/mcp` (AI tool calls) | 150 requests per 15 minutes per token |
| `/auth` (GitHub OAuth) | 20 requests per 15 minutes per IP |
| `/api` (admin API) | 200 requests per 15 minutes per IP |

Exceeding a limit returns:
```json
{ "error": "Rate limit exceeded. Please slow down your AI agent requests.", "retryAfter": "15 minutes" }
```

---

## Security

- **One token per GitHub account** — enforced at the database level with a unique index
- **Tokens stored in VS Code SecretStorage** — not in settings.json or any readable file
- **OAuth state parameter** — CSRF protection on the GitHub login flow
- **Token passed via URL fragment** — never hits server logs after OAuth completes
- **Token-based rate limiting** — limits are per token, not just per IP
- **No code storage** — the relay only forwards tool calls and results, never stores file contents
- **Workspace-only file access** — delete and write operations are restricted to the open VS Code workspace

---

## Admin Panel

The admin panel at `/admin?key=YOUR_ADMIN_KEY` shows every user who has signed in via GitHub, including:

- GitHub avatar and username (with a link to their profile)
- Name and email pulled from their GitHub account
- Their FlowDev token and MCP URL (with one-click copy)
- Sign-in date and current status (approved / revoked)
- **Revoke** and **Delete** actions per user
- Auto-refreshes every 30 seconds — new sign-ins appear without a manual reload

---

## Tech Stack

| Layer | Technology |
|---|---|
| MCP Server | Node.js · TypeScript · Express · [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| Relay | Socket.io (persistent WebSocket per user) |
| Auth | GitHub OAuth 2.0 |
| Database | Neon PostgreSQL (serverless) |
| Rate limiting | express-rate-limit |
| VS Code Extension | TypeScript · VS Code Extension API · socket.io-client |
| Hosting | Render.com |

---

## Self-Hosting

Clone the repo and set these environment variables:

```env
DATABASE_URL=postgresql://...        # Neon or any PostgreSQL
GITHUB_CLIENT_ID=...                 # GitHub OAuth App client ID
GITHUB_CLIENT_SECRET=...             # GitHub OAuth App client secret
PUBLIC_URL=https://your-domain.com   # Your deployed URL
ADMIN_KEY=your-secret-admin-key      # Admin dashboard key
PORT=3000
```

**GitHub OAuth App setup:**
1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL: your `PUBLIC_URL`
3. Authorization callback URL: `PUBLIC_URL/auth/github/callback`
4. Copy the Client ID and generate a Client Secret

```bash
cd server
npm install
npm run build
npm start
```

---

## MCP Marketplace Listings

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=successO.flowdevmcp)
- [GitHub](https://github.com/Oko300/FlowDev)

---

## Links

- **Get access:** https://flowdev.onrender.com/login
- **GitHub:** https://github.com/Oko300/FlowDev
- **X:** https://x.com/success_o1
- **LinkedIn:** https://www.linkedin.com/in/success-o-1376b1344
