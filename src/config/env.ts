import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_TOKEN: z.string().min(1),
  /** Optional — defaults to `{BASE_URL}/callback` when unset. */
  DISCORD_REDIRECT_URI: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Public-facing origin (e.g. https://your-app.onrender.com). Used for OAuth links and MCP Server URL. */
  BASE_URL: z.string().url(),
  /** HTTP listen port. Render injects PORT automatically; defaults to 3000 locally. */
  PORT: z.coerce.number().int().positive().default(3000),
  /** `sse` mounts /mcp on the unified HTTP server (production). `stdio` is for local Cursor only. */
  MCP_TRANSPORT: z.enum(["stdio", "sse"]).default("sse"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  OAUTH_STATE_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse({
    ...process.env,
    PORT: process.env.PORT ?? "3000",
  });

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return result.data;
}

/** Validated environment variables — loaded once at startup. */
export const env = parseEnv();

/** OAuth callback URL sent to Discord — explicit env or derived from BASE_URL. */
export const discordRedirectUri =
  env.DISCORD_REDIRECT_URI ?? new URL("/callback", env.BASE_URL).href;

/** MCP Streamable HTTP endpoint for Poke Recipe "Server URL" configuration. */
export const mcpServerUrl = new URL("/mcp", env.BASE_URL).href;

/** Discord bot permission bitfield for OAuth bot scope. */
export const DISCORD_BOT_PERMISSIONS =
  0x2n | // Kick Members
  0x4n | // Ban Members
  0x10n | // Manage Channels
  0x20n | // Manage Server / AutoMod
  0x40n | // Add Reactions
  0x400n | // View Channels
  0x800n | // Send Messages
  0x2000n | // Manage Messages
  0x4000n | // Embed Links
  0x8000n | // Attach Files
  0x10000n | // Read Message History
  0x40000n | // Use External Emojis
  0x10000000n | // Manage Roles
  0x20000000n | // Manage Webhooks
  0x10000000000n; // Moderate Members

/** Resolved listen port — honors Render's dynamic PORT injection. */
export function getListenPort(): number {
  return Number(process.env.PORT) || env.PORT || 3000;
}
