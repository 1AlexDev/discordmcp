import type { Express } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "../config/env.js";
import { runWithMcpRequestContext } from "./request-context.js";
import { registerDiscordTools, TOOL_COUNT } from "./tools/index.js";
import { interactionStream } from "../discord/automation-engine.js";
import { getPokeUserIdFromRequest } from "../api/session.js";

/** Creates a configured MCP server with all Discord tools registered. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "poke-discord-mcp",
      version: "1.0.0",
    },
    { capabilities: { logging: {} } },
  );

  registerDiscordTools(server);
  return server;
}

/**
 * Mounts Streamable HTTP MCP routes on an existing Express app.
 * POST /mcp handles JSON-RPC; used as the Poke Recipe "Server URL" SSE endpoint.
 */
export function registerMcpHttpRoutes(app: Express): void {
  app.get("/mcp/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const listener = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    interactionStream.listeners.add(listener);

    req.on("close", () => {
      interactionStream.listeners.delete(listener);
    });
  });

  app.post("/mcp", async (req, res) => {
    const pokeUserId = getPokeUserIdFromRequest(req);
    if (!pokeUserId) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Missing Poke user identity. Send X-Poke-Id or X-Poke-User-Id, or link via /auth first.",
        },
        id: req.body?.id ?? null,
      });
      return;
    }

    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await runWithMcpRequestContext({ pokeUserId }, () =>
        transport.handleRequest(req, res, req.body),
      );

      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (err) {
      console.error("[mcp] Request error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  console.log(
    `[mcp] Streamable HTTP routes mounted at POST /mcp (${TOOL_COUNT} tools)`,
  );
}

/** Starts MCP over stdio (local Cursor integration — runs alongside the HTTP server). */
export async function startMcpStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp] stdio transport ready (${TOOL_COUNT} tools registered)`);
}

/** Starts stdio MCP when MCP_TRANSPORT=stdio; HTTP /mcp is mounted by createApp() when sse. */
export async function startMcp(): Promise<void> {
  if (env.MCP_TRANSPORT === "stdio") {
    await startMcpStdio();
  }
}
