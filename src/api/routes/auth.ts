import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { buildDiscordOAuthUrl } from "../discord-oauth.js";
import { createOAuthState, sanitizeReturnTo } from "../oauth-state.js";
import { resolvePokeUserId } from "../session.js";

const returnToQuerySchema = z.object({
  return_to: z.string().optional(),
});

function redirectToDiscord(
  res: Response,
  scope: "login" | "link_guild",
  flow: Parameters<typeof createOAuthState>[0],
): void {
  const state = createOAuthState(flow);
  res.redirect(buildDiscordOAuthUrl(state, scope));
}

export const authRouter = Router();

/** GET /auth/login — Discord OAuth login (identify). */
authRouter.get("/login", (req: Request, res: Response) => {
  const parsed = returnToQuerySchema.safeParse(req.query);
  const returnTo = sanitizeReturnTo(
    parsed.success ? parsed.data.return_to : undefined,
  );
  redirectToDiscord(res, "login", { type: "login", returnTo });
});

/** GET /auth — redirects to Discord login. */
authRouter.get("/", (_req: Request, res: Response) => {
  res.redirect("/auth/login");
});

/** GET /auth/link — link a Discord server (requires login session). */
authRouter.get("/link", async (req: Request, res: Response) => {
  const parsed = returnToQuerySchema.safeParse(req.query);
  const returnTo = sanitizeReturnTo(
    parsed.success ? parsed.data.return_to : undefined,
  );

  const userId = await resolvePokeUserId(req);
  if (!userId) {
    const resume = `/auth/link?return_to=${encodeURIComponent(returnTo)}`;
    res.redirect(`/auth/login?return_to=${encodeURIComponent(resume)}`);
    return;
  }

  redirectToDiscord(res, "link_guild", {
    type: "link_guild",
    userId,
    returnTo,
  });
});

/** @deprecated Manual init removed — use /auth/login or /auth/link. */
authRouter.get("/init", (_req: Request, res: Response) => {
  res.redirect("/auth/login");
});

export function getDiscordLoginUrl(returnTo?: string): string {
  const state = createOAuthState({
    type: "login",
    returnTo: sanitizeReturnTo(returnTo),
  });
  return buildDiscordOAuthUrl(state, "login");
}

export function getDiscordLinkUrl(userId: string, returnTo?: string): string {
  const state = createOAuthState({
    type: "link_guild",
    userId,
    returnTo: sanitizeReturnTo(returnTo),
  });
  return buildDiscordOAuthUrl(state, "link_guild");
}
