import { createApp, startHttpServer } from "./api/server.js";
import { getListenPort } from "./config/env.js";
import { waitForDiscordReady } from "./discord/client.js";
import { startMcp } from "./mcp/server.js";

async function main(): Promise<void> {
  console.log("[poke-discord-mcp] Starting unified server...");

  // Discord bot runs in the background of this same process
  waitForDiscordReady().catch((err) => {
    console.error("[discord] Failed to login:", err);
    process.exit(1);
  });

  const app = createApp();
  const port = getListenPort();

  // stdio MCP for local Cursor; production Render uses HTTP /mcp on the same port
  await startMcp();

  startHttpServer(app, port);
}

main().catch((err) => {
  console.error("[poke-discord-mcp] Fatal error:", err);
  process.exit(1);
});
