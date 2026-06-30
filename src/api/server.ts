import express, { type Express, type Request, type Response } from "express";
import { authRouter } from "./routes/auth.js";
import { callbackRouter } from "./routes/callback.js";
import { dashboardRouter, userApiRouter } from "./routes/dashboard.js";
import { webhookRouter } from "./routes/webhook.js";
import { studioRouter } from "./routes/studio.js";
import { oauthRouter } from "./oauth-provider.js";
import { registerMcpHttpRoutes } from "../mcp/server.js";
import { env } from "../config/env.js";

/**
 * Creates the unified Express application.
 * Serves OAuth linking, health checks, and (when MCP_TRANSPORT=sse) the MCP /mcp endpoint
 * on a single port — required for Render and Poke Recipe "Server URL" integration.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "poke-discord-mcp",
      mcpTransport: env.MCP_TRANSPORT,
      mcpEndpoint: env.MCP_TRANSPORT === "sse" ? "/mcp" : null,
    });
  });

  app.use(oauthRouter);
  app.use("/auth", authRouter);
  app.use("/callback", callbackRouter);
  app.use("/dashboard/studio", studioRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/api", userApiRouter);
  app.use("/webhook", webhookRouter);

  if (env.MCP_TRANSPORT === "sse") {
    registerMcpHttpRoutes(app);
  }

  return app;
}

/** @deprecated Use createApp() — kept for backward compatibility. */
export function createApiServer(): Express {
  return createApp();
}

/** Starts the unified HTTP server on the configured port. */
export function startHttpServer(app: Express, port: number): void {
  app.listen(port, "0.0.0.0", () => {
    console.log(`[server] Listening on 0.0.0.0:${port}`);
    console.log(`[server] Public base URL: ${env.BASE_URL}`);
    console.log(`[server] OAuth UI: ${env.BASE_URL}/auth`);
    console.log(
      `[server] OAuth init: ${env.BASE_URL}/auth/init?poke_user_id=<id>`,
    );
    console.log(`[server] Discord OAuth callback: ${env.BASE_URL}/callback`);
    console.log(
      `[server] MCP OAuth authorize: ${env.BASE_URL}/oauth/authorize`,
    );
    console.log(`[server] MCP OAuth token: ${env.BASE_URL}/oauth/token`);
    console.log(
      `[server] MCP OAuth registration: ${env.BASE_URL}/oauth/register`,
    );
    console.log(`[server] Dashboard: ${env.BASE_URL}/dashboard`);

    if (env.MCP_TRANSPORT === "sse") {
      console.log(`[server] MCP endpoint: ${env.BASE_URL}/mcp`);
    }
  });
}

/** Generic 404 handler — attach after all routes if needed. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}
