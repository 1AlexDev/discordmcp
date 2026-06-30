import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env, mcpServerUrl } from "../config/env.js";
import {
  cleanupExpiredOAuthRecords,
  consumeAuthorizationCode,
  getOAuthClient,
  getUserIdFromAccessToken,
  randomToken,
  registerOAuthClient,
  storeAccessToken,
  storeAuthorizationCode,
  ACCESS_TOKEN_TTL_MS,
} from "../db/auth.js";
import { resolvePokeUserId } from "./session.js";

const DEFAULT_SCOPE = "mcp";
const ACCESS_TOKEN_TTL_SECONDS = Math.floor(ACCESS_TOKEN_TTL_MS / 1000);

const clientRegistrationSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().min(1).max(200).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
});

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
  approve: z.string().optional(),
});

const tokenRequestSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  code_verifier: z.string().min(43),
});

function jsonError(
  res: Response,
  status: number,
  error: string,
  description: string,
): void {
  res.status(status).json({ error, error_description: description });
}

function getIssuer(): string {
  return env.BASE_URL.replace(/\/$/, "");
}

function authorizationServerMetadata() {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [DEFAULT_SCOPE],
    resource_parameter_supported: true,
  };
}

export function protectedResourceMetadataUrl(): string {
  return `${getIssuer()}/.well-known/oauth-protected-resource`;
}

function protectedResourceMetadata() {
  return {
    resource: mcpServerUrl,
    authorization_servers: [getIssuer()],
    bearer_methods_supported: ["header"],
    scopes_supported: [DEFAULT_SCOPE],
    resource_documentation: `${getIssuer()}/auth/login`,
  };
}

async function resolveOAuthClient(clientId: string) {
  const stored = await getOAuthClient(clientId);
  if (stored) return stored;

  if (clientId === "poke-discord-mcp-public") {
    return {
      client_id: clientId,
      client_secret: null,
      client_name: "Public MCP Client",
      redirect_uris: [] as string[],
      created_at: new Date(0).toISOString(),
    };
  }

  return null;
}

function isRedirectUriAllowed(
  redirectUris: string[],
  redirectUri: string,
): boolean {
  if (redirectUris.length === 0) return true;
  return redirectUris.includes(redirectUri);
}

function appendErrorRedirect(
  redirectUri: string,
  error: string,
  description: string,
  state?: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.href;
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const expected = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(codeChallenge);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAuthorizePage(options: {
  clientName: string;
  discordLabel: string;
  params: URLSearchParams;
  error?: string;
}): string {
  const safeClientName = escapeHtml(options.clientName);
  const safeDiscordLabel = escapeHtml(options.discordLabel);
  const safeError = options.error ? escapeHtml(options.error) : null;
  const hiddenInputs = [...options.params.entries()]
    .filter(([key]) => key !== "approve")
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>Authorize MCP Access</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-neutral-950 text-white">
  <main class="flex min-h-screen items-center justify-center px-6 py-12">
    <section class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/70 p-8">
      <div class="mb-8 text-center">
        <p class="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-neutral-500">OAuth for MCP</p>
        <h1 class="text-3xl font-semibold">Connect ${safeClientName}</h1>
        <p class="mt-4 text-sm text-neutral-400">Signed in as <span class="text-white">${safeDiscordLabel}</span></p>
      </div>
      ${safeError ? `<div class="mb-5 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">${safeError}</div>` : ""}
      <form action="/oauth/authorize" method="GET" class="space-y-5">
        ${hiddenInputs}
        <input type="hidden" name="approve" value="1">
        <button type="submit" class="w-full rounded-xl bg-white px-4 py-3 text-[15px] font-semibold text-neutral-950 hover:bg-neutral-200">
          Authorize MCP Access
        </button>
      </form>
      <p class="mt-8 text-center text-xs text-neutral-500">
        <a href="/auth/link" class="font-medium text-neutral-300 hover:text-white">Link a Discord server first</a>
      </p>
    </section>
  </main>
</body>
</html>`;
}

function bodyValue(req: Request, key: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  return body?.[key];
}

export async function getMcpOAuthPokeUserIdFromRequest(
  req: Request,
): Promise<string | null> {
  await cleanupExpiredOAuthRecords();

  const authorization = req.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice("bearer ".length).trim();
  if (!token) return null;

  return getUserIdFromAccessToken(token);
}

export const oauthRouter = Router();

oauthRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json(authorizationServerMetadata());
});

oauthRouter.get("/.well-known/oauth-authorization-server/mcp", (_req, res) => {
  res.json(authorizationServerMetadata());
});

oauthRouter.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json(protectedResourceMetadata());
});

oauthRouter.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
  res.json(protectedResourceMetadata());
});

oauthRouter.post("/oauth/register", async (req, res) => {
  const parsed = clientRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    jsonError(res, 400, "invalid_client_metadata", "Invalid client metadata.");
    return;
  }

  const clientId = randomToken("mcp_client");
  const client = await registerOAuthClient({
    clientId,
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
  });

  res.status(201).json({
    client_id: client.client_id,
    client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
    redirect_uris: client.redirect_uris,
    client_name: client.client_name,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: DEFAULT_SCOPE,
  });
});

oauthRouter.get("/oauth/authorize", async (req: Request, res: Response) => {
  await cleanupExpiredOAuthRecords();

  const parsed = authorizeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).type("text").send("Invalid OAuth authorization request.");
    return;
  }

  const query = parsed.data;
  const client = await resolveOAuthClient(query.client_id);
  if (!client) {
    res.status(400).type("text").send("Unknown OAuth client.");
    return;
  }

  if (!isRedirectUriAllowed(client.redirect_uris, query.redirect_uri)) {
    res.status(400).type("text").send("Invalid OAuth redirect URI.");
    return;
  }

  if (query.resource && query.resource !== mcpServerUrl) {
    res.redirect(
      appendErrorRedirect(
        query.redirect_uri,
        "invalid_target",
        "Unsupported OAuth resource.",
        query.state,
      ),
    );
    return;
  }

  const userId = await resolvePokeUserId(req);
  if (!userId) {
    res.redirect(
      `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`,
    );
    return;
  }

  if (query.approve !== "1") {
    res.type("html").send(
      renderAuthorizePage({
        clientName: client.client_name ?? client.client_id,
        discordLabel: userId,
        params: new URLSearchParams(req.query as Record<string, string>),
      }),
    );
    return;
  }

  const code = randomToken("mcp_code");
  await storeAuthorizationCode({
    code,
    clientId: client.client_id,
    redirectUri: query.redirect_uri,
    userId,
    scope: query.scope || DEFAULT_SCOPE,
    codeChallenge: query.code_challenge,
  });

  const redirectUrl = new URL(query.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (query.state) redirectUrl.searchParams.set("state", query.state);
  res.redirect(redirectUrl.href);
});

oauthRouter.post("/oauth/token", async (req: Request, res: Response) => {
  await cleanupExpiredOAuthRecords();

  const parsed = tokenRequestSchema.safeParse({
    grant_type: bodyValue(req, "grant_type"),
    code: bodyValue(req, "code"),
    redirect_uri: bodyValue(req, "redirect_uri"),
    client_id: bodyValue(req, "client_id"),
    code_verifier: bodyValue(req, "code_verifier"),
  });

  if (!parsed.success) {
    jsonError(res, 400, "invalid_request", "Invalid token request.");
    return;
  }

  const request = parsed.data;
  const code = await consumeAuthorizationCode(request.code);

  if (!code) {
    jsonError(res, 400, "invalid_grant", "Authorization code is invalid or expired.");
    return;
  }

  if (
    code.client_id !== request.client_id ||
    code.redirect_uri !== request.redirect_uri
  ) {
    jsonError(res, 400, "invalid_grant", "Authorization code does not match this client.");
    return;
  }

  if (!verifyPkce(request.code_verifier, code.code_challenge)) {
    jsonError(res, 400, "invalid_grant", "PKCE verification failed.");
    return;
  }

  const token = randomToken("mcp_token");
  await storeAccessToken({
    token,
    clientId: code.client_id,
    userId: code.user_id,
    scope: code.scope,
  });

  res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: code.scope,
  });
});

// Top-level /login alias for convenience
oauthRouter.get("/login", (_req, res) => {
  res.redirect("/auth/login");
});
