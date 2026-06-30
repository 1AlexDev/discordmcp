import type { Request, Response } from "express";
import { env } from "../config/env.js";
import {
  createUserSession,
  deleteUserSession,
  getUserIdFromSessionToken,
} from "../db/auth.js";

export const SESSION_COOKIE = "poke_session";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

const POKE_USER_HEADER_NAMES = [
  "x-poke-id",
  "x-poke-user-id",
  "x-poke-user",
  "x-user-id",
];

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((cookies, pair) => {
    const [rawName, ...rawValue] = pair.trim().split("=");
    if (!rawName) return cookies;

    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("="));
    } catch {
      cookies[rawName] = rawValue.join("=");
    }
    return cookies;
  }, {});
}

function getSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookies(req.get("cookie"));
  const token = cookies[SESSION_COOKIE]?.trim();
  return token || null;
}

/**
 * Resolves the authenticated Poke user ID (Discord user snowflake).
 * Order: session cookie → legacy headers/query (deprecated).
 */
export async function resolvePokeUserId(req: Request): Promise<string | null> {
  const sessionToken = getSessionTokenFromRequest(req);
  if (sessionToken) {
    const userId = await getUserIdFromSessionToken(sessionToken);
    if (userId) return userId;
  }

  return getLegacyPokeUserIdFromRequest(req);
}

/** Sync helper for legacy integrations — prefer resolvePokeUserId. */
export function getLegacyPokeUserIdFromRequest(req: Request): string | null {
  const queryValue = req.query.poke_user_id ?? req.query.poke_id;
  const queryPokeUserId =
    typeof queryValue === "string" ? queryValue.trim() : undefined;
  if (queryPokeUserId) return queryPokeUserId;

  for (const headerName of POKE_USER_HEADER_NAMES) {
    const headerPokeUserId = req.get(headerName)?.trim();
    if (headerPokeUserId) return headerPokeUserId;
  }

  return null;
}

/** @deprecated Use resolvePokeUserId for session-aware auth. */
export function getPokeUserIdFromRequest(req: Request): string | null {
  return getLegacyPokeUserIdFromRequest(req);
}

/** Creates a session and stores the token in an HTTP-only cookie. */
export async function establishUserSession(
  res: Response,
  userId: string,
): Promise<void> {
  const sessionToken = await createUserSession(userId);
  setSessionCookie(res, sessionToken);
  setLegacyPokeUserCookie(res, userId);
}

export function setSessionCookie(res: Response, sessionToken: string): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Max-Age=${THIRTY_DAYS_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

export function setLegacyPokeUserCookie(res: Response, pokeUserId: string): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `poke_user_id=${encodeURIComponent(pokeUserId)}; Max-Age=${THIRTY_DAYS_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

/** @deprecated Use establishUserSession. */
export function setPokeUserCookie(res: Response, pokeUserId: string): void {
  setLegacyPokeUserCookie(res, pokeUserId);
}

/** Clears session and legacy cookies (logout). */
export async function clearUserSession(req: Request, res: Response): Promise<void> {
  const sessionToken = getSessionTokenFromRequest(req);
  if (sessionToken) {
    await deleteUserSession(sessionToken).catch(() => undefined);
  }

  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
  res.append(
    "Set-Cookie",
    `poke_user_id=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

/** @deprecated Use clearUserSession. */
export function clearPokeUserCookie(res: Response): void {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `poke_user_id=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}
