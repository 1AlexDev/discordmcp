import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { upsertAccountLink } from "../../db/supabase.js";
import { upsertAppUser } from "../../db/auth.js";
import { getDiscordClient, waitForDiscordReady } from "../../discord/client.js";
import {
  exchangeDiscordCode,
  fetchDiscordUserProfile,
} from "../discord-oauth.js";
import { sanitizeReturnTo, verifyOAuthState } from "../oauth-state.js";
import { establishUserSession } from "../session.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  guild_id: z.string().min(1).optional(),
  permissions: z.string().optional(),
});

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
</head>
<body class="bg-white text-neutral-900 min-h-screen flex items-center justify-center">
  <main class="w-full max-w-sm px-6 text-center">
    <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl ${iconColor} mb-5">${iconSvg}</div>
    <h1 class="text-xl font-semibold tracking-tight">${title}</h1>
    <p class="mt-2 text-sm text-neutral-500 leading-relaxed">${message}</p>
    ${cta ? `<a href="${cta.href}" class="mt-6 inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white">${cta.label}</a>` : ""}
  </main>
</body>
</html>`;
}

export const callbackRouter = Router();

/** GET /callback — unified Discord OAuth callback. */
callbackRouter.get("/", async (req: Request, res: Response) => {
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
          "Missing required callback parameters. Please retry.",
          true,
        ),
      );
    return;
  }

  const { code, state, guild_id, permissions } = parsed.data;

  try {
    const flow = verifyOAuthState(state);
    const tokens = await exchangeDiscordCode(code);
    const discordUser = await fetchDiscordUserProfile(tokens.access_token);

    await upsertAppUser({
      discordUserId: discordUser.id,
      discordUsername: discordUser.username,
      discordGlobalName: discordUser.global_name,
      discordAvatar: discordUser.avatar,
    });

    if (flow.type === "login") {
      await establishUserSession(res, discordUser.id);
      res.redirect(sanitizeReturnTo(flow.returnTo));
      return;
    }

    if (flow.userId !== discordUser.id) {
      res
        .status(403)
        .type("html")
        .send(
          renderStatusPage(
            "Account Mismatch",
            "The Discord account used for linking must match your logged-in account.",
            true,
          ),
        );
      return;
    }

    if (!guild_id) {
      res
        .status(400)
        .type("html")
        .send(
          renderStatusPage(
            "No Server Selected",
            "Choose a Discord server during authorization to link it.",
            true,
            { href: "/auth/link", label: "Try again" },
          ),
        );
      return;
    }

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const botPermissions = permissions ? BigInt(permissions) : undefined;

    await upsertAccountLink({
      pokeUserId: discordUser.id,
      discordUserId: discordUser.id,
      discordGuildId: guild_id,
      discordUsername: discordUser.global_name ?? discordUser.username,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt,
      botPermissions,
    });

    await establishUserSession(res, discordUser.id);

    await waitForDiscordReady();
    const client = getDiscordClient();
    const guild =
      client.guilds.cache.get(guild_id) ??
      (await client.guilds.fetch(guild_id).catch(() => null));

    const returnTo = sanitizeReturnTo(flow.returnTo);

    if (!guild) {
      res
        .status(202)
        .type("html")
        .send(
          renderStatusPage(
            "Linked, Still Syncing",
            "Your server link was saved. The bot may still be joining — check the dashboard shortly.",
            false,
            { href: returnTo, label: "Open dashboard" },
          ),
        );
      return;
    }

    res
      .status(200)
      .type("html")
      .send(
        renderStatusPage(
          "Server Linked",
          "Your Discord server is connected.",
          false,
          { href: returnTo, label: "Open dashboard" },
        ),
      );
  } catch (err) {
    console.error(
      "[callback] OAuth failed:",
      err instanceof Error ? err.message : err,
    );
    res
      .status(500)
      .type("html")
      .send(
        renderStatusPage(
          "Authentication Failed",
          err instanceof Error ? err.message : "An unexpected error occurred.",
          true,
          { href: "/auth/login", label: "Try again" },
        ),
      );
  }
});
