import type { Request, Response } from "express";
import { env } from "../config/env.js";

const POKE_USER_COOKIE = "poke_user_id";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((cookies, pair) => {
    const [rawName, ...rawValue] = pair.trim().split("=");
    if (!rawName) return cookies;

    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});
}

/** Reads the current Poke user from query params, headers, or secure cookie. */
export function getPokeUserIdFromRequest(req: Request): string | null {
  const queryValue = req.query.poke_user_id;
  const queryPokeUserId =
    typeof queryValue === "string" ? queryValue.trim() : undefined;
  if (queryPokeUserId) return queryPokeUserId;

  const headerPokeUserId = req.get("x-poke-user-id")?.trim();
  if (headerPokeUserId) return headerPokeUserId;

  const cookies = parseCookies(req.get("cookie"));
  const cookiePokeUserId = cookies[POKE_USER_COOKIE]?.trim();
  return cookiePokeUserId || null;
}

/** Stores a Poke user ID in an HTTP-only cookie for dashboard/API requests. */
export function setPokeUserCookie(res: Response, pokeUserId: string): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${POKE_USER_COOKIE}=${encodeURIComponent(
      pokeUserId,
    )}; Max-Age=${THIRTY_DAYS_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

/** Clears the dashboard Poke user cookie. */
export function clearPokeUserCookie(res: Response): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${POKE_USER_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}
