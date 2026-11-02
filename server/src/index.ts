import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { adminRouter, validateToken, initDB } from './admin';
import { authRouter, migrateGithubColumns } from './auth';
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ─────────────────────────────────────────
// RATE LIMITING
// Protects Render free tier from AI agent loops and abuse.
// MCP endpoint: 100 req / 15 min per IP.
// Auth endpoints: 20 req / 15 min (prevent OAuth spam).
// ─────────────────────────────────────────
const mcpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate-limit per token when available, fall back to IP
    const token = (req.query.token as string) || (req.headers['x-flowdev-token'] as string);
    return token || req.ip || 'unknown';
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: "Rate limit exceeded. Please slow down your AI agent requests.",
      retryAfter: "15 minutes"
    });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many authentication attempts. Please try again in 15 minutes." });
  }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Rate limit exceeded. Please slow down your requests." });
  }
});

// Apply rate limiters
app.use('/mcp', mcpLimiter);
app.use('/auth', authLimiter);
app.use('/api', apiLimiter);

app.use(adminRouter);
app.use(authRouter);

// ─────────────────────────────────────────
// SOCKET.IO — relay bridge to VS Code extension
// ─────────────────────────────────────────
const io = new SocketServer(httpServer, {
  cors: { origin: "*" },
  // More tolerant timeouts for Render free tier latency spikes.
  // Default pingTimeout (20s) is too tight — Render can stall for 5-10s under load.
  pingInterval: 25000,   // how often server pings the client
  pingTimeout:  60000,   // how long to wait for pong before declaring dead
} as any);

// Which users have VS Code open and connected — keyed by their personal token
const connectedExtensions = new Map<string, string>();

// Last heartbeat timestamp per userId. Extension sends a ping every 25s.
// If no heartbeat for 90s the connection is considered a ghost and removed.
const lastHeartbeat = new Map<string, number>();

// Stale-connection cleanup — runs every 60s
setInterval(() => {
  const threshold = Date.now() - 90_000;
  for (const [uid, ts] of lastHeartbeat) {
    if (ts < threshold) {
      connectedExtensions.delete(uid);
      lastHeartbeat.delete(uid);
      console.log(`🧹 Removed ghost connection: ${uid.substring(0, 12)}...`);
    }
  }
}, 60_000);

// Pending tool calls waiting for extension to respond
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId as string;

  if (!userId || userId === "default") {
    console.log("⚠️  Extension connected without a valid userId — rejecting");
    socket.disconnect();
    return;
  }

  connectedExtensions.set(userId, socket.id);
  socket.join(`user:${userId}`);
  console.log(`🔌 VS Code Extension connected — user: ${userId.substring(0, 12)}...`);

  socket.on("disconnect", () => {
    connectedExtensions.delete(userId);
    lastHeartbeat.delete(userId);
    console.log(`❌ VS Code Extension disconnected — user: ${userId.substring(0, 12)}...`);
  });

  // Update heartbeat timestamp when extension pings us
  socket.on("heartbeat", () => {
    lastHeartbeat.set(userId, Date.now());
  });

  // Seed the heartbeat so the extension gets 90s grace on first connect
  lastHeartbeat.set(userId, Date.now());

  socket.on("tool_result", ({ requestId, success, data, error }: any) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);
    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error));
    }
  });
});

// Wait up to `maxWaitMs` for the extension to appear in connectedExtensions.
// This covers the reconnection gap after a Render redeploy or network blip:
// the extension's Socket.io client reconnects within seconds, but there's a
// brief window where it's not in the map yet — we shouldn't fail immediately.
function waitForExtension(userId: string, maxWaitMs = 20000): Promise<void> {
  if (connectedExtensions.has(userId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (connectedExtensions.has(userId)) {
        clearInterval(check);
        resolve();
      } else if (Date.now() - start >= maxWaitMs) {
        clearInterval(check);
        reject(new Error(
          "VS Code extension is not connected. " +
          "Open VS Code and make sure FlowDev shows 'Connected' in the status bar, then try again."
        ));
      }
    }, 500);
  });
}

async function relayToExtension(userId: string, tool: string, params: any): Promise<any> {
  // Wait for extension — handles the post-redeploy reconnection gap
  await waitForExtension(userId);

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Extension timed out after 30s. Is VS Code still open?"));
    }, 30_000);

    pendingRequests.set(requestId, { resolve, reject, timeout });
    io.to(`user:${userId}`).emit("execute_tool", { requestId, tool, params });
  });
}

// ─────────────────────────────────────────
// MCP SERVER FACTORY
// ─────────────────────────────────────────
function createMcpServer(userId: string): McpServer {
  const mcp: any = new McpServer({
    name: "flowdev",
    version: "1.0.0"
  });

  // ── ping ──────────────────────────────────────────────────────────────────
  mcp.tool(
    "ping",
    "Test that FlowDev is alive and show connection status",
    {},
    async () => {
      const isConnected = connectedExtensions.has(userId);
      return {
        content: [{
          type: "text" as const,
          text: [
            "✅ FlowDev is online!",
            `📡 Server running on port ${PORT}`,
            `🔌 Your VS Code extension: ${isConnected ? "Connected ✅" : "Not connected ❌"}`,
            `👥 Total extensions connected: ${connectedExtensions.size}`,
            "",
            "File tools:  read_file · write_file · find_and_replace · delete_file · rename_file · create_directory",
            "Search:      search_in_files",
            "Terminal:    run_command",
            "Navigation:  list_directory · get_project_structure",
            "Git:         git_status · git_diff · git_add · git_commit · git_push"
          ].join("\n")
        }]
      };
    }
  );

  // ── read_file ─────────────────────────────────────────────────────────────
  mcp.tool(
    "read_file",
    "Read the contents of any file in the user's project",
    {
      path: z.string().describe("Relative path to file, e.g. src/index.ts or package.json")
    },
    async ({ path }) => {
      try {
        const result = await relayToExtension(userId, "read_file", { path });
        return {
          content: [{
            type: "text" as const,
            text: `📄 ${path}\n${"─".repeat(40)}\n${result.content}`
          }]
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ Could not read file: ${err.message}` }] };
      }
    }
  );

  // ── write_file ────────────────────────────────────────────────────────────
  mcp.tool(
    "write_file",
    "Write or create a file in the user's project. Auto-analyzes code quality after saving.",
    {
      path: z.string().describe("Relative path where the file should be saved"),
      content: z.string().describe("Full content to write into the file")
    },
    async ({ path, content }) => {
      try {
        const result = await relayToExtension(userId, "write_file", { path, content });
        const lines = [
          `✅ Saved: ${path}`,
          `📏 ${content.split("\n").length} lines written`,
        ];
        if (result.analysis) { lines.push("", "📊 Code Analysis:", result.analysis); }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ Could not write file: ${err.message}` }] };
      }
    }
  );

  // ── find_and_replace ──────────────────────────────────────────────────────
  mcp.tool(
    "find_and_replace",
    "Find exact text in a file and replace it. Safer than rewriting the whole file for small targeted edits — renames a function, fixes a variable, updates a value.",
    {
      path: z.string().describe("Relative path to the file"),
      find: z.string().describe("The exact text to find (must exist in the file)"),
      replace: z.string().describe("The text to replace it with")
    },
    async ({ path, find, replace }) => {
      try {
        const result = await relayToExtension(userId, "find_and_replace", { path, find, replace });
        const lines = [`✅ ${result.message}`];
        if (result.analysis) { lines.push("", "📊 Code Analysis:", result.analysis); }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── search_in_files ───────────────────────────────────────────────────────
  mcp.tool(
    "search_in_files",
    "Search for any text or pattern across all project files — like grep. Returns file path, line number, and matching line. Use this to find where a function is used, where a variable is defined, or where an error string appears.",
    {
      query: z.string().describe("Text to search for"),
      caseSensitive: z.boolean().optional().describe("Case sensitive search — defaults to false")
    },
    async ({ query, caseSensitive }) => {
      try {
        const result = await relayToExtension(userId, "search_in_files", { query, caseSensitive: caseSensitive ?? false });
        return { content: [{ type: "text" as const, text: result.output }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── create_directory ──────────────────────────────────────────────────────
  mcp.tool(
    "create_directory",
    "Create a new directory (and any missing parent directories) in the project",
    {
      path: z.string().describe("Relative path to create, e.g. src/utils or src/components/forms")
    },
    async ({ path }) => {
      try {
        const result = await relayToExtension(userId, "create_directory", { path });
        return { content: [{ type: "text" as const, text: `✅ ${result.message}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── delete_file ───────────────────────────────────────────────────────────
  mcp.tool(
    "delete_file",
    "Delete a file from the project. Only operates inside the workspace — cannot delete system files.",
    {
      path: z.string().describe("Relative path of the file to delete")
    },
    async ({ path }) => {
      try {
        const result = await relayToExtension(userId, "delete_file", { path });
        return { content: [{ type: "text" as const, text: `✅ ${result.message}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── rename_file ───────────────────────────────────────────────────────────
  mcp.tool(
    "rename_file",
    "Rename or move a file within the project. Use this to reorganize files during refactoring.",
    {
      old_path: z.string().describe("Current relative path of the file"),
      new_path: z.string().describe("New relative path — rename or move destination")
    },
    async ({ old_path, new_path }) => {
      try {
        const result = await relayToExtension(userId, "rename_file", { old_path, new_path });
        return { content: [{ type: "text" as const, text: `✅ ${result.message}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── git_diff ──────────────────────────────────────────────────────────────
  mcp.tool(
    "git_diff",
    "Show what has changed in the code — unstaged changes by default, or staged changes ready to commit. Use this before committing to review what will be included.",
    {
      staged: z.boolean().optional().describe("If true, shows staged changes (git diff --staged). Defaults to false (unstaged changes).")
    },
    async ({ staged }) => {
      try {
        const result = await relayToExtension(userId, "git_diff", { staged: staged ?? false });
        const output = result.stdout || "(no changes)";
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── run_command ───────────────────────────────────────────────────────────
  mcp.tool(
    "run_command",
    "Run any terminal command in the user's project (npm install, npm run dev, git commands, etc)",
    {
      command: z.string().describe("The terminal command to run"),
      cwd: z.string().optional().describe("Working directory — defaults to project root")
    },
    async ({ command, cwd }) => {
      try {
        const result = await relayToExtension(userId, "run_command", { command, cwd });
        return {
          content: [{
            type: "text" as const,
            text: [
              `$ ${command}`,
              "─".repeat(40),
              result.stdout || "(no output)",
              result.stderr ? `\n⚠️  stderr:\n${result.stderr}` : "",
              `\nExit code: ${result.exitCode === 0 ? "✅ 0 (success)" : `❌ ${result.exitCode}`}`
            ].join("\n")
          }]
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ Command failed: ${err.message}` }] };
      }
    }
  );

  // ── list_directory ────────────────────────────────────────────────────────
  mcp.tool(
    "list_directory",
    "List all files and folders inside a directory in the project",
    {
      path: z.string().optional().describe("Relative directory path, defaults to project root")
    },
    async ({ path: dirPath }) => {
      try {
        const result = await relayToExtension(userId, "list_directory", { path: dirPath || "." });
        return { content: [{ type: "text" as const, text: result.output }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── get_project_structure ─────────────────────────────────────────────────
  mcp.tool(
    "get_project_structure",
    "Get the full file and folder tree of the entire project so Claude can understand the codebase layout",
    {},
    async () => {
      try {
        const result = await relayToExtension(userId, "get_project_structure", {});
        return { content: [{ type: "text" as const, text: result.output }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── git_status ────────────────────────────────────────────────────────────
  mcp.tool(
    "git_status",
    "Check the current git status — shows changed, staged, and untracked files",
    {},
    async () => {
      try {
        const result = await relayToExtension(userId, "git_status", {});
        return { content: [{ type: "text" as const, text: result.stdout || result.stderr }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── git_add ───────────────────────────────────────────────────────────────
  mcp.tool(
    "git_add",
    "Stage files for a git commit",
    {
      files: z.string().optional().describe("File or folder to stage. Defaults to all changes (.)")
    },
    async ({ files }) => {
      try {
        const result = await relayToExtension(userId, "git_add", { files: files || "." });
        return {
          content: [{
            type: "text" as const,
            text: `✅ Staged: ${files || "all changes"}\n${result.stdout || result.stderr || "Done"}`
          }]
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── git_commit ────────────────────────────────────────────────────────────
  mcp.tool(
    "git_commit",
    "Commit staged changes with a descriptive message",
    {
      message: z.string().describe("A clear commit message describing what changed")
    },
    async ({ message }) => {
      try {
        const result = await relayToExtension(userId, "git_commit", { message });
        return {
          content: [{
            type: "text" as const,
            text: `✅ Committed: "${message}"\n${result.stdout || result.stderr}`
          }]
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  // ── git_push ──────────────────────────────────────────────────────────────
  mcp.tool(
    "git_push",
    "Push committed changes to GitHub",
    {
      branch: z.string().optional().describe("Branch to push to. Defaults to main")
    },
    async ({ branch }) => {
      try {
        const result = await relayToExtension(userId, "git_push", { branch: branch || "main" });
        return {
          content: [{
            type: "text" as const,
            text: `✅ Pushed to GitHub (${branch || "main"})\n${result.stdout || result.stderr}`
          }]
        };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
      }
    }
  );

  return mcp;
}

// ─────────────────────────────────────────
// MCP ENDPOINT
// ─────────────────────────────────────────
app.all("/mcp", async (req, res) => {
  const token = (req.query.token as string) || (req.headers['x-flowdev-token'] as string);

  if (!token) {
    res.status(401).json({
      error: "No token provided. Add ?token=YOUR_TOKEN to the MCP URL.",
      help: "Request access at https://flowdev.onrender.com/request"
    });
    return;
  }

  if (!validateToken(token)) {
    res.status(401).json({
      error: "Invalid or revoked token.",
      help: "Request access at https://flowdev.onrender.com/request"
    });
    return;
  }

  const userId = token;
  const mcp = createMcpServer(userId);

  console.log(`🤖 Claude connected — user: ${userId.substring(0, 12)}...`);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
    console.log(`Claude disconnected — user: ${userId.substring(0, 12)}...`);
  });

  await mcp.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// OAuth discovery
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
  });
});

app.post('/oauth/register', (req, res) => {
  res.json({
    client_id: 'flowdev-' + Date.now(),
    client_secret: 'flowdev-secret',
    redirect_uris: req.body?.redirect_uris || [],
  });
});

app.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state } = req.query;
  res.redirect(`${redirect_uri}?code=flowdev-auth-code&state=${state}`);
});

app.post('/oauth/token', (req, res) => {
  res.json({
    access_token: 'flowdev-access-token-' + Date.now(),
    token_type: 'Bearer',
    expires_in: 86400,
  });
});

// Health check
app.get("/", (_req, res) => {
  res.json({
    name: "FlowDev MCP Server",
    version: "2.0.0",
    status: "running ✅",
    extensionsConnected: connectedExtensions.size,
    getAccess: "/login",
    mcpEndpoint: "/mcp?token=YOUR_TOKEN",
    tools: [
      "ping", "read_file", "write_file", "find_and_replace",
      "search_in_files", "create_directory", "delete_file", "rename_file",
      "run_command", "list_directory", "get_project_structure",
      "git_status", "git_diff", "git_add", "git_commit", "git_push"
    ]
  });
});

// ─────────────────────────────────────────
// START
// Open the port immediately so Render marks the service live and the extension
// can create its Socket.io connection right away. DB init happens in parallel —
// the /mcp endpoint checks `serverReady` and returns 503 until it's true.
// ─────────────────────────────────────────
let serverReady = false;

// Middleware: hold /mcp requests until DB is ready
app.use('/mcp', (req, res, next) => {
  if (!serverReady) {
    res.status(503).json({
      error: "Server is starting up. Please retry in a few seconds.",
      retryAfter: 5
    });
    return;
  }
  next();
});

httpServer.listen(PORT, () => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  🚀  FlowDev Server is running`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  📡  MCP: http://localhost:${PORT}/mcp?token=YOUR_TOKEN`);
  console.log(`  ⏳  Waiting for database...`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Init DB after port is open
  Promise.all([initDB(), migrateGithubColumns()])
    .then(() => {
      serverReady = true;
      console.log(`✅  Server fully ready — accepting MCP connections`);
    })
    .catch(err => {
      console.error('❌ Database init failed:', err.message);
      process.exit(1);
    });
});
