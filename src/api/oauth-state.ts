import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const STATE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getStateSecret(): string {
  return env.OAUTH_STATE_SECRET ?? "dev-insecure-state-secret-change-me";
}

/** Encodes pokeUserId + timestamp + HMAC into a URL-safe state token. */
export function createOAuthState(pokeUserId: string): string {
  const timestamp = Date.now();
  const payload = JSON.stringify({ pokeUserId, timestamp });
  const signature = createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(JSON.stringify({ payload, signature })).toString(
    "base64url",
  );
}

/** Validates and decodes an OAuth state token. Returns pokeUserId or throws. */
export function verifyOAuthState(state: string): string {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid OAuth state encoding");
  }

  let pokeUserId: string;
  let timestamp: number;
  let signature: string;
  let payload: string;

  try {
    const parsed = JSON.parse(decoded) as {
      payload?: unknown;
      signature?: unknown;
    };
    if (
      typeof parsed.payload !== "string" ||
      typeof parsed.signature !== "string"
    ) {
      throw new Error("Invalid OAuth state payload");
    }

    const payloadData = JSON.parse(parsed.payload) as {
      pokeUserId?: unknown;
      timestamp?: unknown;
    };
    if (typeof payloadData.pokeUserId !== "string") {
      throw new Error("Invalid OAuth state user");
    }

    pokeUserId = payloadData.pokeUserId;
    timestamp = Number(payloadData.timestamp);
    signature = parsed.signature;
    payload = parsed.payload;
  } catch {
    // Backward compatibility for older links generated as pokeUserId:timestamp:signature.
    const parts = decoded.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid OAuth state format");
    }

    const [legacyPokeUserId, legacyTimestamp, legacySignature] = parts;
    pokeUserId = legacyPokeUserId;
    timestamp = Number(legacyTimestamp);
    signature = legacySignature;
    payload = `${legacyPokeUserId}:${legacyTimestamp}`;
  }

  const expected = createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid OAuth state signature");
  }

  const age = Date.now() - timestamp;
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
