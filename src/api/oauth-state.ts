import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const STATE_TTL_MS = 30 * 60 * 1000;

export type OAuthFlow =
  | { type: "login"; returnTo?: string }
  | { type: "link_guild"; userId: string; returnTo?: string };

function getStateSecret(): string {
  return env.OAUTH_STATE_SECRET ?? "dev-insecure-state-secret-change-me";
}

function signPayload(payload: string): string {
  return createHmac("sha256", getStateSecret()).update(payload).digest("hex");
}

/** Encodes an OAuth flow + timestamp + HMAC into a URL-safe state token. */
export function createOAuthState(flow: OAuthFlow): string {
  const envelope = {
    flow,
    timestamp: Date.now(),
  };
  const payload = JSON.stringify(envelope);
  const signature = signPayload(payload);
  return Buffer.from(JSON.stringify({ payload, signature })).toString(
    "base64url",
  );
}

/** Validates and decodes an OAuth state token. */
export function verifyOAuthState(state: string): OAuthFlow {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid OAuth state encoding");
  }

  try {
    const parsed = JSON.parse(decoded) as {
      payload?: unknown;
      signature?: unknown;
    };

    if (
      typeof parsed.payload !== "string" ||
      typeof parsed.signature !== "string"
    ) {
      throw new Error("Invalid OAuth state envelope");
    }

    const expected = signPayload(parsed.payload);
    const sigBuf = Buffer.from(parsed.signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (
      sigBuf.length !== expBuf.length ||
      !timingSafeEqual(sigBuf, expBuf)
    ) {
      throw new Error("Invalid OAuth state signature");
    }

    const envelope = JSON.parse(parsed.payload) as {
      flow?: OAuthFlow;
      timestamp?: unknown;
    };

    const timestamp = Number(envelope.timestamp);
    const age = Date.now() - timestamp;
    if (Number.isNaN(age) || age > STATE_TTL_MS) {
      throw new Error("OAuth state expired");
    }

    if (!envelope.flow?.type) {
      throw new Error("Invalid OAuth state flow");
    }

    return envelope.flow;
  } catch (err) {
    try {
      const legacyUserId = verifyLegacyOAuthState(state);
      return { type: "link_guild", userId: legacyUserId };
    } catch {
      throw err instanceof Error ? err : new Error("Invalid OAuth state");
    }
  }
}

function verifyLegacyOAuthState(state: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid legacy OAuth state");
  }

  const parsed = JSON.parse(decoded) as {
    payload?: string;
    signature?: string;
  };

  if (typeof parsed.payload !== "string" || typeof parsed.signature !== "string") {
    throw new Error("Invalid legacy OAuth state");
  }

  const payloadData = JSON.parse(parsed.payload) as {
    pokeUserId?: string;
    timestamp?: number;
  };

  if (!payloadData.pokeUserId) {
    throw new Error("Missing pokeUserId in legacy state");
  }

  const expected = signPayload(parsed.payload);
  const sigBuf = Buffer.from(parsed.signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid legacy OAuth state signature");
  }

  const age = Date.now() - Number(payloadData.timestamp);
  if (Number.isNaN(age) || age > STATE_TTL_MS) {
    throw new Error("OAuth state expired");
  }

  return payloadData.pokeUserId;
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

/** Validates a same-origin return path to prevent open redirects. */
export function sanitizeReturnTo(returnTo?: string): string {
  if (!returnTo) return "/dashboard";

  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/dashboard";
  }

  return returnTo;
}
