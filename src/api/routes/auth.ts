import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env, DISCORD_BOT_PERMISSIONS, discordRedirectUri } from "../../config/env.js";
import { createOAuthState } from "../oauth-state.js";

const authQuerySchema = z.object({
  poke_user_id: z.string().min(1, "poke_user_id query parameter is required"),
});

const DISCORD_OAUTH_BASE = "https://discord.com/api/oauth2/authorize";

/**
 * Builds the Discord OAuth2 authorization URL.
 * Includes bot scope so the user adds our bot to their selected server.
 */
function buildDiscordAuthUrl(pokeUserId: string): string {
  const state = createOAuthState(pokeUserId);

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: discordRedirectUri,
    response_type: "code",
    scope: "identify guilds bot",
    state,
    permissions: DISCORD_BOT_PERMISSIONS.toString(),
  });

  return `${DISCORD_OAUTH_BASE}?${params.toString()}`;
}

export const authRouter = Router();

/**
 * GET /auth?poke_user_id=...
 * Redirects the user to Discord to authorize and add the bot to a server.
 */
authRouter.get("/", (req: Request, res: Response) => {
  const parsed = authQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const authUrl = buildDiscordAuthUrl(parsed.data.poke_user_id);
  res.redirect(authUrl);
});

/** Exported for testing — returns the URL without redirecting. */
export function getDiscordAuthUrl(pokeUserId: string): string {
  return buildDiscordAuthUrl(pokeUserId);
}
