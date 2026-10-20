# FlowDev

**Connect any MCP-compatible AI directly to your VS Code workspace.**

Stop copy-pasting code between your AI and your editor. FlowDev lets Claude, Cursor, Windsurf, Cline, Continue (and any MCP client) read files, write code, search your codebase, run terminal commands, and push to GitHub — all from the chat window.

Your code never leaves your machine. The cloud relay is only a secure bridge.

---

## How It Works

```
You chat with your AI  (Claude, Cursor, etc.)
           ↓
FlowDev Cloud Relay  (flowdev.onrender.com)
           ↓
FlowDev VS Code Extension
           ↓
Your local files · terminal · Git
```

1. Install the FlowDev extension in VS Code  
2. Request a free access token  
3. Paste your personal MCP URL into your AI client  
4. Start building — the AI can now work inside your real project

---

## Features

| Category | Capabilities |
|----------|--------------|
| **Files** | Read, write, create, rename, delete, find & replace |
| **Search** | Full-project search (grep-style) |
| **Terminal** | Run any shell command safely |
| **Navigation** | List directories, get full project structure |
| **Git** | Status, diff, add, commit, push |
| **Status** | Live connection indicator in VS Code status bar |

---

## Getting Started

### 1. Request Access

FlowDev uses approved access to keep quality high.

**Request your free token:** [https://flowdev.onrender.com/request](https://flowdev.onrender.com/request)

You will receive a personal token by email (usually within 24 hours).

### 2. Install the Extension

- Open VS Code
- Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
- Search for **FlowDev MCP**
- Click **Install**

Or install from the VSIX in the `extension/flowdev-extension` folder.

### 3. Connect

1. Click the **FlowDev** icon in the Activity Bar
2. Paste your access token and click **Connect**
3. Copy your personal **MCP URL** shown in the sidebar

### 4. Add to Your AI Client

**Claude.ai**  
Settings → Connectors → Add Custom Connector → paste your MCP URL → No sign-in

**Cursor / Windsurf / Cline / Continue**  
Add the MCP URL as a custom MCP server in the client settings.

Once the status bar shows **FlowDev: Connected**, you’re ready.

---

## Example Prompts

```
Read my package.json and summarize the dependencies
Search the whole project for every use of useEffect
Add proper error handling to the Express routes
Create a new utility file for date formatting
Commit all changes with a clear message and push to main
```

---

## Project Structure

```
FlowDev/
├── server/                 # Cloud relay + MCP server (Node.js + Express + Socket.io)
│   └── src/
│       ├── index.ts        # MCP tools + Socket.io bridge
│       └── admin.ts        # Access request + admin dashboard
├── extension/
│   └── flowdev-extension/  # VS Code extension
│       └── src/extension.ts
└── README.md
```

---

## Security

- Each user gets a unique personal token
- Tokens are stored with VS Code SecretStorage (never in plain settings)
- The relay does **not** store or log your source code
- All file and terminal operations execute only on your local machine
- Manual review before access is granted

---

## Status Bar States

| Status | Meaning |
|--------|---------|
| `FlowDev: Connected` | AI can access your workspace |
| `FlowDev: Connecting...` | Establishing connection |
| `FlowDev: Waking server...` | Cold start (usually < 30s) |
| `FlowDev: Reconnecting...` | Temporary disconnect, auto-retry |
| `FlowDev: Setup Required` | Token not set yet |

---

## Development

### Server
```bash
cd server
npm install
npm run dev          # development with nodemon
npm run build && npm start
```

### Extension
```bash
cd extension/flowdev-extension
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

---

## Links

- **Request Access:** [https://flowdev.onrender.com/request](https://flowdev.onrender.com/request)
- **Marketplace / Extension:** Search “FlowDev MCP” in VS Code
- **GitHub:** [https://github.com/Oko300/FlowDev](https://github.com/Oko300/FlowDev)
- **X:** [@success_o1](https://x.com/success_o1)
- **LinkedIn:** [Success O](https://www.linkedin.com/in/success-o-1376b1344)

---

## License

MIT

Built with focus by [Oko300](https://github.com/Oko300).
