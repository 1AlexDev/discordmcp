import type { Express, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "../config/env.js";
import { runWithMcpRequestContext } from "./request-context.js";
import { registerDiscordTools, TOOL_COUNT } from "./tools/index.js";
import { interactionStream } from "../discord/automation-engine.js";
import { resolvePokeUserId } from "../api/session.js";
import {
  getMcpOAuthPokeUserIdFromRequest,
  protectedResourceMetadataUrl,
} from "../api/oauth-provider.js";

async function resolveMcpPokeUserId(req: Request): Promise<string | null> {
  return (
    (await getMcpOAuthPokeUserIdFromRequest(req)) ??
    (await resolvePokeUserId(req))
  );
}

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
  const sendMcpAuthChallenge = (req: Request, res: Response) => {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${protectedResourceMetadataUrl()}"`,
    );
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Missing MCP authorization. Start OAuth using the advertised protected-resource metadata, or send X-Poke-Id/X-Poke-User-Id for legacy Poke integrations.",
      },
      id: req.body?.id ?? null,
    });
  };

  app.get("/mcp", async (req, res) => {
    const pokeUserId = await resolveMcpPokeUserId(req);
    if (!pokeUserId) {
      sendMcpAuthChallenge(req, res);
      return;
    }

    res.status(405).json({
      error: "Method not allowed. Send MCP JSON-RPC requests with POST /mcp.",
    });
  });

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
    const pokeUserId = await resolveMcpPokeUserId(req);
    if (!pokeUserId) {
      sendMcpAuthChallenge(req, res);
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
