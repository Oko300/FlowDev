# FlowDev - Your AI Works Inside VS Code Now

Stop switching tabs. Stop copy-pasting code. FlowDev connects any MCP-compatible AI directly to your VS Code workspace. Your AI reads your files, writes code, runs terminal commands, and pushes to GitHub without you leaving your editor.

Works with Claude, Grok, GPT-4, Gemini, and any other AI that supports the Model Context Protocol (MCP).

---

## How It Works

```
You chat with your AI (browser or app)
         |
FlowDev Cloud Relay (flowdev.onrender.com)
         |
FlowDev Extension (installed in your VS Code)
         |
Your local files, terminal, and GitHub
```

Your AI sends instructions through the relay. The extension runs them on your machine. Your code never gets stored anywhere. The relay is just a bridge.

---

## Features

### File Operations
Your AI reads any file in your project and writes changes straight to disk. Tell it to read a file and refactor a function. It opens the file, understands it, rewrites it, and saves it. No clipboard needed.

### Terminal Commands
Your AI runs any command in your project terminal. npm install, build scripts, test runners, migration commands. Results come back to the AI in real time so it can fix issues automatically.

### Built-in Code Analyzer
Every file write gets scanned before saving. The analyzer catches:
- Hardcoded API keys and passwords
- HTTP used instead of HTTPS
- Dangerous eval() calls
- Missing error handling on async functions
- console.log left in production code

Your AI sees the warnings and fixes them before the file lands on disk.

### Git Integration
Your AI checks git status, stages files, commits with a message, and pushes to GitHub without you touching the terminal.

### Project Awareness
Your AI scans your entire folder tree and understands your project structure before touching anything. It knows where files live and how things connect.

### Auto-Reconnect
If the connection drops, the extension reconnects on its own. No manual action needed.

---

## Getting Started

### Step 1 - Request Access

FlowDev uses approved access to keep quality high.

Request access here: https://flowdev.onrender.com/request

Fill in your name, email, and what you are building. The owner reviews requests and approves within 24 hours. You get your personal access token by email.

### Step 2 - Enter Your Token

After installing, look at the bottom-left status bar in VS Code. Click the FlowDev icon and choose Enter Token. Paste the token from your email.

Your token is stored using VS Code encrypted secret storage. It is not saved in any settings file or plain text.

### Step 3 - Add the MCP Connector

In your AI app (Claude, Grok, or any MCP-compatible client):

1. Find the connectors or tools settings
2. Add a custom MCP connector
3. Use this URL with your token: https://flowdev.onrender.com/mcp?token=YOUR_TOKEN

For Claude.ai specifically:
1. Go to Settings then Connectors then Add Custom Connector
2. Paste the URL above
3. Enable it inside any chat using the tools icon near the message input

### Step 4 - Start Building

Make sure the status bar shows FlowDev Connected, then go to your AI and start:

"Read my package.json and tell me what is outdated"

"Add rate limiting to my Express server with proper error handling"

"Run the tests and fix whatever is failing"

"Commit everything we did today and push to main"

---

## Status Bar

The FlowDev item in the bottom-left VS Code status bar shows what is happening:

Connected means your AI can access your workspace.
Connecting means it is establishing the connection.
Token required means you need to enter your access token first.
Connection failed means check your token or internet.

Click the status bar icon to disconnect, change your token, or get access.

---

## Commands

Open the Command Palette (Ctrl+Shift+P) and search:

FlowDev: Connect to Server
FlowDev: Disconnect from Server
FlowDev: Set Access Token
FlowDev: Show Status

---

## Supported AI Clients

FlowDev works with any AI that supports MCP (Model Context Protocol):

- Claude (claude.ai)
- Grok
- GPT-4 with MCP support
- Gemini with MCP support
- Any other MCP-compatible AI client

---

## Security

Your token is unique to you. No two users share one. The relay routes commands only to the extension connected with your token.

Your token is stored using VS Code SecretStorage, the same method VS Code uses for passwords. It is not in settings.json or any readable file.

The FlowDev relay server does not read, store, or log your code. It only forwards tool calls and results.

All file reads, writes, and commands run on your own machine through the extension. Nothing runs in the cloud.

Every user is reviewed and approved manually before getting a token.

---

## Troubleshooting

Status bar shows Connection failed: Check your internet. Try FlowDev: Set Access Token and re-enter your token.

AI says no tools available: Make sure you enabled the FlowDev connector in that chat session.

Extension connected but AI cannot read files: Make sure you have a folder open in VS Code, not just a single file.

Token not working after approval email: Copy the token exactly as it appears. Use FlowDev: Set Access Token to re-enter it.

---

## Get Access

Access is free and request-based.

Request your token here: https://flowdev.onrender.com/request

---

## Links

Website: https://flowdev.onrender.com
GitHub: https://github.com/Oko300/FlowDev
X: https://x.com/success_o1
LinkedIn: https://www.linkedin.com/in/success-o-1376b1344
