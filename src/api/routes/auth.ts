import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  env,
  DISCORD_BOT_PERMISSIONS,
  discordRedirectUri,
} from "../../config/env.js";
import { createOAuthState } from "../oauth-state.js";
import { getPokeUserIdFromRequest, setPokeUserCookie } from "../session.js";

const initQuerySchema = z
  .object({
    poke_user_id: z.string().optional(),
    poke_id: z.string().optional(),
  })
  .transform((value) => ({
    poke_user_id: (value.poke_user_id ?? value.poke_id ?? "").trim(),
  }))
  .refine((value) => value.poke_user_id.length > 0, {
    message: "Poke ID is required",
    path: ["poke_user_id"],
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

/** Returns the auth landing page HTML with Tailwind CSS. */
function renderAuthPage(
  options: { pokeUserId?: string | null; error?: string } = {},
): string {
  const safePokeUserId = options.pokeUserId
    ? options.pokeUserId
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;")
    : "";
  const errorHtml = options.error
    ? `<div class="mb-5 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">${options.error}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>Link Discord — Poke</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: dark; }
    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
      background: #09090b;
    }
    .page-enter {
      animation: page-enter 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .mark-enter {
      animation: mark-enter 640ms cubic-bezier(0.16, 1, 0.3, 1) 80ms both;
    }
    .field-focus {
      transition: border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
    }
    .field-focus:focus {
      transform: translateY(-1px);
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.08);
    }
    .cta {
      transition: background-color 180ms ease, color 180ms ease, transform 180ms ease;
    }
    .cta:hover {
      transform: translateY(-1px);
    }
    .cta:active {
      transform: translateY(0) scale(0.99);
    }
    .cta[aria-busy="true"] .button-label {
      opacity: 0;
    }
    .cta[aria-busy="true"] .button-loader {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    .button-loader {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.96);
      transition: opacity 160ms ease, transform 160ms ease;
    }
    .dot {
      animation: dot-pulse 900ms ease-in-out infinite;
    }
    .dot:nth-child(2) { animation-delay: 120ms; }
    .dot:nth-child(3) { animation-delay: 240ms; }
    @keyframes page-enter {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes mark-enter {
      from { opacity: 0; transform: translateY(6px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes dot-pulse {
      0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 1ms !important;
      }
    }
  </style>
</head>
<body class="min-h-screen bg-neutral-950 text-white selection:bg-white selection:text-neutral-950">
  <main class="min-h-screen flex items-center justify-center px-6 py-12">
    <section class="page-enter w-full max-w-[380px]">
      <div class="mb-12 text-center">
        <div class="mark-enter mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-950 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
          </svg>
        </div>
        <p class="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-neutral-500">Poke Discord MCP</p>
        <h1 class="text-3xl font-semibold tracking-[-0.04em] text-white">Link your Discord</h1>
        <p class="mx-auto mt-4 max-w-xs text-sm leading-6 text-neutral-400">
          Enter your Poke ID to authorize Discord and connect your server.
        </p>
      </div>

      ${errorHtml}
      <form action="/auth/init" method="GET" class="space-y-5" id="auth-form">
        <div class="space-y-2">
          <label for="poke_user_id" class="block text-sm font-medium text-neutral-300">
            Poke ID
          </label>
          <input
            type="text"
            id="poke_user_id"
            name="poke_user_id"
            required
            autocomplete="off"
            spellcheck="false"
            placeholder="Your Poke user ID"
            value="${safePokeUserId}"
            class="field-focus w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-[15px] text-white outline-none placeholder:text-neutral-600 hover:border-neutral-700 focus:border-white focus:bg-neutral-900"
          >
        </div>

        <button
          type="submit"
          class="cta relative w-full rounded-xl bg-white px-4 py-3 text-[15px] font-semibold text-neutral-950 hover:bg-neutral-200 focus:outline-none focus:ring-4 focus:ring-white/10"
          id="submit-button"
        >
          <span class="button-label transition-opacity duration-150">Continue with Discord</span>
          <span class="button-loader absolute left-1/2 top-1/2 flex items-center gap-1" aria-hidden="true">
            <span class="dot h-1.5 w-1.5 rounded-full bg-neutral-950"></span>
            <span class="dot h-1.5 w-1.5 rounded-full bg-neutral-950"></span>
            <span class="dot h-1.5 w-1.5 rounded-full bg-neutral-950"></span>
          </span>
        </button>
      </form>

      <div class="mt-8 space-y-3 text-center text-xs leading-5 text-neutral-500">
        <p>You will be redirected to Discord to authorize the bot and choose a server.</p>
        ${safePokeUserId ? `<a href="/dashboard" class="font-medium text-neutral-300 transition-colors hover:text-white">Open dashboard instead</a>` : ""}
      </div>
    </section>
  </main>

  <script>
    const form = document.getElementById('auth-form');
    const button = document.getElementById('submit-button');

    form?.addEventListener('submit', () => {
      button?.setAttribute('aria-busy', 'true');
    });
  </script>
</body>
</html>`;
}

export const authRouter = Router();

/**
 * GET /auth
 * Serves a clean HTML page where users enter their Poke ID to start OAuth linking.
 */
authRouter.get("/", (req: Request, res: Response) => {
  res
    .type("html")
    .send(renderAuthPage({ pokeUserId: getPokeUserIdFromRequest(req) }));
});

/**
 * GET /auth/init?poke_user_id=...
 * Validates the Poke ID, generates OAuth state, and redirects to Discord.
 */
authRouter.get("/init", (req: Request, res: Response) => {
  const parsed = initQuerySchema.safeParse(req.query);
  const pokeUserId = parsed.success
    ? parsed.data.poke_user_id
    : getPokeUserIdFromRequest(req);

  if (!pokeUserId) {
    res
      .status(400)
      .type("html")
      .send(
        renderAuthPage({
          pokeUserId: getPokeUserIdFromRequest(req),
          error: "Enter your Poke ID to continue with Discord.",
        }),
      );
    return;
  }

  setPokeUserCookie(res, pokeUserId);
  const authUrl = buildDiscordAuthUrl(pokeUserId);
  res.redirect(authUrl);
});

/** Exported for testing — returns the URL without redirecting. */
export function getDiscordAuthUrl(pokeUserId: string): string {
  return buildDiscordAuthUrl(pokeUserId);
}
