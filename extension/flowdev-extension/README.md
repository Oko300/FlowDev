# FlowDev MCP

**Connect any MCP-compatible AI directly to your VS Code workspace.**

Stop copy-pasting code between your AI and your editor. FlowDev lets your AI read files, write code, search your codebase, run terminal commands, and push to GitHub — all from the chat window.

Works with **Claude, Cursor, Windsurf, Cline, Continue** and any AI that supports the Model Context Protocol (MCP).

---

## How It Works

```
You chat with your AI  (browser or app)
           ↓
FlowDev Cloud Relay  (flowdev.onrender.com)
           ↓
FlowDev Extension  (installed in your VS Code)
           ↓
Your local files, terminal, and GitHub
```

Your AI sends instructions through the relay. The extension executes them on your machine. Your code never gets stored anywhere — the relay is just a bridge.

---

## Getting Started

### Step 1 — Request Access

FlowDev uses approved access to keep quality high and abuse out.

**Request your free token here:** https://flowdev.onrender.com/request

Fill in your name, email, and what you are building. You will get a personal token by email within 24 hours.

### Step 2 — Paste Your Token in VS Code

Click the **FlowDev ⚡ icon** in the Activity Bar on the left side of VS Code. Paste your token in the input and click **Connect**.

Once connected, the sidebar shows your personal **MCP URL**. Copy it — you will need it in Step 3.

### Step 3 — Add the MCP Connector in Your AI

**For Claude.ai:**
1. Go to **Settings → Connectors → Add Custom Connector**
2. Paste your MCP URL
3. Select **"No sign-in"**
4. Click Add, then Connect

**For Cursor / Windsurf / Cline / Continue:**
Add the MCP URL as a custom MCP server in your AI's settings.

### Step 4 — Start Building

Make sure the status bar shows **FlowDev: Connected**, then tell your AI what to do:

> "Read my package.json and tell me what packages are outdated"

> "Search my project for all uses of useEffect"

> "Add rate limiting to my Express server with proper error handling"

> "Commit everything and push to main"

---

## Tools Available (16 total)

| Category | Tools |
|---|---|
| **Files** | `read_file` · `write_file` · `find_and_replace` · `delete_file` · `rename_file` · `create_directory` |
| **Search** | `search_in_files` — grep across your entire codebase |
| **Terminal** | `run_command` — run any shell command |
| **Navigation** | `list_directory` · `get_project_structure` |
| **Git** | `git_status` · `git_diff` · `git_add` · `git_commit` · `git_push` |
| **Status** | `ping` — confirm connection |

---

## Status Bar

The FlowDev item in the bottom-left VS Code status bar shows the current state:

| Status | Meaning |
|---|---|
| `⚡ FlowDev: Connected` | Your AI can access your workspace |
| `⟳ FlowDev: Connecting...` | Establishing connection |
| `⟳ FlowDev: Waking server...` | Server is starting up (takes ~30s on first connect) |
| `⟳ FlowDev: Reconnecting...` | Lost connection, retrying automatically |
| `🔑 FlowDev: Setup Required` | Paste your token to connect |

The extension reconnects automatically on VS Code restart, window reload, and PC restart. No manual action needed.

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and search:

- `FlowDev: Connect to Server`
- `FlowDev: Disconnect from Server`
- `FlowDev: Set Access Token`
- `FlowDev: Show Status`

---

## Security

- Your token is unique to you — no two users share one
- Tokens are stored using VS Code **SecretStorage** (the same method VS Code uses for passwords), not in settings.json
- The relay server does not read, store, or log your code — it only forwards tool calls and results
- All file reads, writes, and commands run on your own machine
- Every user is reviewed and approved manually before getting a token

---

## Troubleshooting

**Status bar shows "Waking server..."**
The server is starting up. Wait up to 30 seconds — it connects automatically.

**Status bar shows "Reconnecting..."**
Lost connection. The extension retries automatically. If it stays for more than a minute, check your internet.

**AI says no tools available**
Make sure you enabled the FlowDev connector inside that chat session (the connector must be toggled on per chat in Claude.ai).

**Extension connected but AI cannot read files**
Make sure you have a folder open in VS Code (File → Open Folder), not just a single file.

**Token not working after approval email**
Copy the token exactly as shown. Use the FlowDev sidebar to clear and re-enter it.

---

## Links

- **Request access:** https://flowdev.onrender.com/request
- **GitHub:** https://github.com/Oko300/FlowDev
- **X (Twitter):** https://x.com/success_o1
- **LinkedIn:** https://www.linkedin.com/in/success-o-1376b1344
