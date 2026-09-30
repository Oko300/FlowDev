import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { adminRouter, validateToken } from './admin';
dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(adminRouter);

// ─────────────────────────────────────────
// SOCKET.IO — relay bridge to VS Code extension
// ─────────────────────────────────────────
const io = new SocketServer(httpServer, {
  cors: { origin: "*" }
} as any);

// Which users have VS Code open and connected
const connectedExtensions = new Map<string, string>();

// Pending tool calls waiting for extension to respond
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

io.on("connection", (socket) => {
  const userId = socket.handshake.query.userId as string || "default";
  connectedExtensions.set(userId, socket.id);
  socket.join(`user:${userId}`);
  console.log(`🔌 VS Code Extension connected — user: ${userId}`);

  socket.on("disconnect", () => {
    connectedExtensions.delete(userId);
    console.log(`❌ VS Code Extension disconnected — user: ${userId}`);
  });

  // Extension sends back the result of a tool execution
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

// Send a tool call to the VS Code extension and wait for result
function relayToExtension(userId: string, tool: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!connectedExtensions.has(userId)) {
      reject(new Error(
        "VS Code Extension is not connected.\n" +
        "Make sure your FlowDev extension is running in VS Code."
      ));
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Extension timed out. Is VS Code still open?"));
    }, 30_000);

    pendingRequests.set(requestId, { resolve, reject, timeout });
    io.to(`user:${userId}`).emit("execute_tool", { requestId, tool, params });
  });
}

// ─────────────────────────────────────────
// MCP SERVER — the tools Claude can call
// ─────────────────────────────────────────
const mcp = new McpServer({
  name: "flowdev",
  version: "1.0.0"
});

// ── Tool: ping ──────────────────────────
mcp.tool(
  "ping",
  "Test that FlowDev is alive and show connection status",
  {},
  async () => ({
    content: [{
      type: "text" as const,
      text: [
        "✅ FlowDev is online!",
        `📡 Server running on port ${PORT}`,
        `🔌 VS Code extensions connected: ${connectedExtensions.size}`,
        "",
        "Available tools: ping · read_file · write_file · run_command",
        "More coming: git_commit · git_push · analyze_code · list_directory"
      ].join("\n")
    }]
  })
);

// ── Tool: read_file ──────────────────────
mcp.tool(
  "read_file",
  "Read the contents of any file in the user's project",
  {
    path: z.string().describe("Relative path to file, e.g. src/index.ts or package.json")
  },
  async ({ path }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    try {
      const result = await relayToExtension(userId, "read_file", { path });
      return {
        content: [{
          type: "text" as const,
          text: `📄 ${path}\n${"─".repeat(40)}\n${result.content}`
        }]
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `❌ Could not read file: ${err.message}` }]
      };
    }
  }
);

// ── Tool: write_file ─────────────────────
mcp.tool(
  "write_file",
  "Write or create a file in the user's project. Auto-analyzes code quality after saving.",
  {
    path: z.string().describe("Relative path where the file should be saved"),
    content: z.string().describe("Full content to write into the file")
  },
  async ({ path, content }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    try {
      const result = await relayToExtension(userId, "write_file", { path, content });
      const lines = [
        `✅ Saved: ${path}`,
        `📏 ${content.split("\n").length} lines written`,
      ];
      if (result.analysis) {
        lines.push("", "📊 Code Analysis:", result.analysis);
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }]
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `❌ Could not write file: ${err.message}` }]
      };
    }
  }
);

// ── Tool: run_command ────────────────────
mcp.tool(
  "run_command",
  "Run any terminal command in the user's project (npm install, npm run dev, git commands, etc)",
  {
    command: z.string().describe("The terminal command to run"),
    cwd: z.string().optional().describe("Working directory — defaults to project root")
  },
  async ({ command, cwd }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
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
      return {
        content: [{ type: "text" as const, text: `❌ Command failed: ${err.message}` }]
      };
    }
  }
);

// ── Tool: list_directory ─────────────────
mcp.tool(
  "list_directory",
  "List all files and folders inside a directory in the project",
  {
    path: z.string().optional().describe("Relative directory path, defaults to project root")
  },
  async ({ path: dirPath }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    try {
      const result = await relayToExtension(userId, "list_directory", { path: dirPath || "." });
      return { content: [{ type: "text" as const, text: result.output }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
    }
  }
);

// ── Tool: get_project_structure ──────────
mcp.tool(
  "get_project_structure",
  "Get the full file and folder tree of the entire project so Claude can understand the codebase layout",
  {},
  async () => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    try {
      const result = await relayToExtension(userId, "get_project_structure", {});
      return { content: [{ type: "text" as const, text: result.output }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
    }
  }
);

// ── Tool: git_status ─────────────────────
mcp.tool(
  "git_status",
  "Check the current git status — shows changed, staged, and untracked files",
  {},
  async () => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    try {
      const result = await relayToExtension(userId, "run_command", { command: "git status" });
      return { content: [{ type: "text" as const, text: result.stdout || result.stderr }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
    }
  }
);

// ── Tool: git_add ────────────────────────
mcp.tool(
  "git_add",
  "Stage files for a git commit",
  {
    path: z.string().optional().describe("File or folder to stage. Defaults to all changes (git add .)")
  },
  async ({ path: filePath }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    const command = `git add ${filePath || "."}`;
    try {
      const result = await relayToExtension(userId, "run_command", { command });
      return {
        content: [{
          type: "text" as const,
          text: `✅ Staged: ${filePath || "all changes"}\n${result.stdout || result.stderr || "Done"}`
        }]
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `❌ ${err.message}` }] };
    }
  }
);

// ── Tool: git_commit ─────────────────────
mcp.tool(
  "git_commit",
  "Commit staged changes with a descriptive message",
  {
    message: z.string().describe("A clear commit message describing what changed")
  },
  async ({ message }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    const command = `git commit -m "${message}"`;
    try {
      const result = await relayToExtension(userId, "run_command", { command });
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

// ── Tool: git_push ───────────────────────
mcp.tool(
  "git_push",
  "Push committed changes to GitHub",
  {
    branch: z.string().optional().describe("Branch to push to. Defaults to main")
  },
  async ({ branch }) => {
    const userId = [...connectedExtensions.keys()][0] || "default";
    const command = `git push origin ${branch || "main"}`;
    try {
      const result = await relayToExtension(userId, "run_command", { command });
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

// Streamable HTTP transport (required by Claude.ai)
app.all("/mcp", async (req, res) => {
const token = (req.query.token as string) || req.headers['x-flowdev-token'] as string;
if (token && !validateToken(token)) {
res.status(401).json({ error: "Invalid or revoked token. Request access at /request" });
return;
}
console.log("🤖 Claude connected via POST");
const transport = new StreamableHTTPServerTransport({
sessionIdGenerator: undefined,
});
res.on("close", () => {
transport.close();
console.log("Claude disconnected.");
});
await mcp.connect(transport);
await transport.handleRequest(req, res, req.body);
});

// OAuth discovery - required by Claude.ai to connect
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

// OAuth dynamic client registration
app.post('/oauth/register', (req, res) => {
  res.json({
    client_id: 'flowdev-' + Date.now(),
    client_secret: 'flowdev-secret',
    redirect_uris: req.body?.redirect_uris || [],
  });
});

// OAuth authorize - auto approves for now
app.get('/oauth/authorize', (req, res) => {
  const { redirect_uri, state, code_challenge } = req.query;
  res.redirect(`${redirect_uri}?code=flowdev-auth-code&state=${state}`);
});

// OAuth token exchange
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
    version: "1.0.0",
    status: "running ✅",
    extensionsConnected: connectedExtensions.size,
    mcpEndpoint: `http://localhost:${PORT}/mcp`
  });
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  🚀  FlowDev Server is running`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  📡  MCP: http://localhost:${PORT}/mcp`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});