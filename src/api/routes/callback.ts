import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env, discordRedirectUri } from "../../config/env.js";
import { upsertAccountLink } from "../../db/supabase.js";
import { verifyOAuthState } from "../oauth-state.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  guild_id: z.string().min(1).optional(),
  permissions: z.string().optional(),
});

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name?: string | null;
}

/** Exchanges an authorization code for Discord OAuth tokens. */
async function exchangeCodeForTokens(code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: discordRedirectUri,
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord token exchange failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<DiscordTokenResponse>;
}

/** Fetches the authenticated Discord user's profile. */
async function fetchDiscordUser(accessToken: string): Promise<DiscordUserResponse> {
  const response = await fetch(DISCORD_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord user fetch failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<DiscordUserResponse>;
}

export const callbackRouter = Router();

/**
 * GET /callback
 * Handles the Discord OAuth redirect, persists the account link, and confirms success.
 */
callbackRouter.get("/", async (req: Request, res: Response) => {
  // Discord sends error query params when the user denies authorization
  if (req.query.error) {
    res.status(400).json({
      error: "OAuth denied",
      message: String(req.query.error_description ?? req.query.error),
    });
    return;
  }

  const parsed = callbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid callback parameters",
      details: parsed.error.flatten().fieldErrors,
      hint: "guild_id is required when using the bot scope — ensure the user selected a server.",
    });
    return;
  }

  const { code, state, guild_id, permissions } = parsed.data;

  if (!guild_id) {
    res.status(400).json({
      error: "Missing guild_id",
      message:
        "No server was selected during authorization. Please retry and choose a Discord server.",
    });
    return;
  }

  try {
    const pokeUserId = verifyOAuthState(state);
    const tokens = await exchangeCodeForTokens(code);
    const discordUser = await fetchDiscordUser(tokens.access_token);

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const botPermissions = permissions ? BigInt(permissions) : undefined;

    await upsertAccountLink({
      pokeUserId,
      discordUserId: discordUser.id,
      discordGuildId: guild_id,
      discordUsername: discordUser.global_name ?? discordUser.username,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt,
      botPermissions,
    });

    res.status(200).json({
      success: true,
      message: "Discord account linked successfully.",
      pokeUserId,
      discordGuildId: guild_id,
      discordUsername: discordUser.global_name ?? discordUser.username,
    });
  } catch (err) {
    console.error("[callback] OAuth linking failed:", err instanceof Error ? err.message : err);
    res.status(500).json({
      error: "Linking failed",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});
