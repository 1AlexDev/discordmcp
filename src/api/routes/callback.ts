import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env, discordRedirectUri } from "../../config/env.js";
import { upsertAccountLink } from "../../db/supabase.js";
import { verifyOAuthState } from "../oauth-state.js";
import { setPokeUserCookie } from "../session.js";

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
async function exchangeCodeForTokens(
  code: string,
): Promise<DiscordTokenResponse> {
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
    throw new Error(
      `Discord token exchange failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<DiscordTokenResponse>;
}

/** Fetches the authenticated Discord user's profile. */
async function fetchDiscordUser(
  accessToken: string,
): Promise<DiscordUserResponse> {
  const response = await fetch(DISCORD_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord user fetch failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<DiscordUserResponse>;
}

/** Returns a minimal HTML status page. */
function renderStatusPage(
  title: string,
  message: string,
  isError: boolean,
  cta?: { href: string; label: string },
): string {
  const iconColor = isError ? "bg-red-600" : "bg-neutral-900";
  const iconSvg = isError
    ? `<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Poke</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body class="bg-white text-neutral-900 min-h-screen flex items-center justify-center">
  <main class="w-full max-w-sm px-6 text-center">
    <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl ${iconColor} mb-5">
      ${iconSvg}
    </div>
    <h1 class="text-xl font-semibold tracking-tight">${title}</h1>
    <p class="mt-2 text-sm text-neutral-500 leading-relaxed">${message}</p>
    ${
      cta
        ? `<a href="${cta.href}" class="mt-6 inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800">${cta.label}</a>`
        : ""
    }
  </main>
</body>
</html>`;
}

export const callbackRouter = Router();

/**
 * GET /callback
 * Handles the Discord OAuth redirect, persists the account link, and confirms success.
 */
callbackRouter.get("/", async (req: Request, res: Response) => {
  // Discord sends error query params when the user denies authorization
  if (req.query.error) {
    const errorMsg = String(req.query.error_description ?? req.query.error);
    res
      .status(400)
      .type("html")
      .send(renderStatusPage("Authorization Denied", errorMsg, true));
    return;
  }

  const parsed = callbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .type("html")
      .send(
        renderStatusPage(
          "Invalid Request",
          "Missing required callback parameters. Please retry the linking process.",
          true,
        ),
      );
    return;
  }

  const { code, state, guild_id, permissions } = parsed.data;

  if (!guild_id) {
    res
      .status(400)
      .type("html")
      .send(
        renderStatusPage(
          "No Server Selected",
          "No Discord server was selected during authorization. Please retry and choose a server.",
          true,
        ),
      );
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

    setPokeUserCookie(res, pokeUserId);
    res
      .status(200)
      .type("html")
      .send(
        renderStatusPage(
          "Successfully Linked",
          "Your Discord server has been connected. You can close this page or open your dashboard.",
          false,
          { href: "/dashboard", label: "Open dashboard" },
        ),
      );
  } catch (err) {
    console.error(
      "[callback] OAuth linking failed:",
      err instanceof Error ? err.message : err,
    );
    res
      .status(500)
      .type("html")
      .send(
        renderStatusPage(
          "Linking Failed",
          err instanceof Error
            ? err.message
            : "An unexpected error occurred. Please try again.",
          true,
        ),
      );
  }
});
