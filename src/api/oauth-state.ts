import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getStateSecret(): string {
  return env.OAUTH_STATE_SECRET ?? "dev-insecure-state-secret-change-me";
}

/** Encodes pokeUserId + timestamp + HMAC into a URL-safe state token. */
export function createOAuthState(pokeUserId: string): string {
  const timestamp = Date.now().toString();
  const payload = `${pokeUserId}:${timestamp}`;
  const signature = createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

/** Validates and decodes an OAuth state token. Returns pokeUserId or throws. */
export function verifyOAuthState(state: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid OAuth state encoding");
  }

  const parts = decoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid OAuth state format");
  }

  const [pokeUserId, timestamp, signature] = parts;
  const payload = `${pokeUserId}:${timestamp}`;
  const expected = createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid OAuth state signature");
  }

  const age = Date.now() - Number(timestamp);
  if (Number.isNaN(age) || age > STATE_TTL_MS) {
    throw new Error("OAuth state expired");
  }

  if (!pokeUserId) {
    throw new Error("Missing pokeUserId in OAuth state");
  }

  return pokeUserId;
}

/** Generates a random nonce for additional CSRF protection if needed. */
export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}
