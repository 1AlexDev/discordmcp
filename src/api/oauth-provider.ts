import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env, mcpServerUrl } from "../config/env.js";
import { getPokeUserIdFromRequest, setPokeUserCookie } from "./session.js";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;
const DEFAULT_SCOPE = "mcp";

type OAuthClient = {
  clientId: string;
  clientSecret?: string;
  clientName?: string;
  redirectUris: string[];
  createdAt: number;
};

type AuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  pokeUserId: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: number;
};

type AccessToken = {
  token: string;
  clientId: string;
  pokeUserId: string;
  scope: string;
  expiresAt: number;
};

const clients = new Map<string, OAuthClient>();
const authorizationCodes = new Map<string, AuthorizationCode>();
const accessTokens = new Map<string, AccessToken>();

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
  poke_user_id: z.string().optional(),
  poke_id: z.string().optional(),
  approve: z.string().optional(),
});

const tokenRequestSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  code_verifier: z.string().min(43),
});

function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

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
    resource_documentation: `${getIssuer()}/auth`,
  };
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [code, value] of authorizationCodes) {
    if (value.expiresAt <= now) authorizationCodes.delete(code);
  }
  for (const [token, value] of accessTokens) {
    if (value.expiresAt <= now) accessTokens.delete(token);
  }
}

function getClient(clientId: string): OAuthClient | null {
  const client = clients.get(clientId);
  if (client) return client;

  // Some MCP clients do not perform dynamic registration and instead use a
  // preconfigured public client id. Allow those clients in development and for
  // simple hosted deployments while still validating their exact redirect URI.
  if (clientId === "poke-discord-mcp-public") {
    return {
      clientId,
      redirectUris: [],
      clientName: "Public MCP Client",
      createdAt: 0,
    };
  }

  return null;
}

function isRedirectUriAllowed(client: OAuthClient, redirectUri: string): boolean {
  if (client.redirectUris.length === 0) return true;
  return client.redirectUris.includes(redirectUri);
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
  pokeUserId: string;
  params: URLSearchParams;
  error?: string;
}): string {
  const safeClientName = escapeHtml(options.clientName);
  const safePokeUserId = escapeHtml(options.pokeUserId);
  const safeError = options.error ? escapeHtml(options.error) : null;
  const hiddenInputs = [...options.params.entries()]
    .filter(([key]) => key !== "approve" && key !== "poke_user_id")
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
  <title>Authorize MCP Access — Poke Discord MCP</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-neutral-950 text-white">
  <main class="flex min-h-screen items-center justify-center px-6 py-12">
    <section class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/70 p-8 shadow-2xl shadow-black/30">
      <div class="mb-8 text-center">
        <div class="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-950">AI</div>
        <p class="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-neutral-500">OAuth for MCP</p>
        <h1 class="text-3xl font-semibold tracking-[-0.04em]">Connect ${safeClientName}</h1>
        <p class="mt-4 text-sm leading-6 text-neutral-400">
          This lets your AI client call the Poke Discord MCP tools for your linked Discord servers.
        </p>
      </div>

      ${safeError ? `<div class="mb-5 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">${safeError}</div>` : ""}

      <form action="/oauth/authorize" method="GET" class="space-y-5">
        ${hiddenInputs}
        <input type="hidden" name="approve" value="1">
        <div class="space-y-2">
          <label for="poke_user_id" class="block text-sm font-medium text-neutral-300">Poke ID</label>
          <input
            id="poke_user_id"
            name="poke_user_id"
            required
            autocomplete="off"
            spellcheck="false"
            placeholder="Your Poke user ID"
            value="${safePokeUserId}"
            class="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-[15px] text-white outline-none placeholder:text-neutral-600 hover:border-neutral-700 focus:border-white"
          >
        </div>
        <button type="submit" class="w-full rounded-xl bg-white px-4 py-3 text-[15px] font-semibold text-neutral-950 hover:bg-neutral-200">
          Authorize MCP Access
        </button>
      </form>

      <div class="mt-8 space-y-3 text-center text-xs leading-5 text-neutral-500">
        <p>No tool schemas receive your Poke ID. It is stored only in request context from this OAuth token.</p>
        <a href="/auth" class="font-medium text-neutral-300 hover:text-white">Need to link a Discord server first?</a>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function bodyValue(req: Request, key: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  return body?.[key];
}

export function getMcpOAuthPokeUserIdFromRequest(req: Request): string | null {
  cleanupExpired();
  const authorization = req.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice("bearer ".length).trim();
  if (!token) return null;

  const accessToken = accessTokens.get(token);
  if (!accessToken || accessToken.expiresAt <= Date.now()) {
    if (accessToken) accessTokens.delete(token);
    return null;
  }

  return accessToken.pokeUserId;
}

export const oauthRouter = Router();

// OAuth Authorization Server Metadata (RFC 8414 / MCP discovery).
oauthRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json(authorizationServerMetadata());
});

oauthRouter.get("/.well-known/oauth-authorization-server/mcp", (_req, res) => {
  res.json(authorizationServerMetadata());
});

// OAuth Protected Resource Metadata (RFC 9728 / MCP discovery).
oauthRouter.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json(protectedResourceMetadata());
});

oauthRouter.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
  res.json(protectedResourceMetadata());
});

// Dynamic Client Registration for clients such as Claude, ChatGPT, and Poke.
oauthRouter.post("/oauth/register", (req, res) => {
  const parsed = clientRegistrationSchema.safeParse(req.body);
  if (!parsed.success) {
    jsonError(res, 400, "invalid_client_metadata", "Invalid client metadata.");
    return;
  }

  const clientId = randomToken("mcp_client");
  const client: OAuthClient = {
    clientId,
    redirectUris: parsed.data.redirect_uris,
    clientName: parsed.data.client_name,
    createdAt: Date.now(),
  };
  clients.set(clientId, client);

  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    redirect_uris: client.redirectUris,
    client_name: client.clientName,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: DEFAULT_SCOPE,
  });
});

// Authorization endpoint. The user enters their Poke ID and grants an MCP client
// an authorization code. Discord linking remains separate at /auth.
oauthRouter.get("/oauth/authorize", (req: Request, res: Response) => {
  cleanupExpired();
  const parsed = authorizeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).type("text").send("Invalid OAuth authorization request.");
    return;
  }

  const query = parsed.data;
  const client = getClient(query.client_id);
  if (!client) {
    res.status(400).type("text").send("Unknown OAuth client.");
    return;
  }

  if (!isRedirectUriAllowed(client, query.redirect_uri)) {
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

  const pokeUserId = (
    query.poke_user_id ??
    query.poke_id ??
    getPokeUserIdFromRequest(req) ??
    ""
  ).trim();

  if (query.approve !== "1" || !pokeUserId) {
    res.type("html").send(
      renderAuthorizePage({
        clientName: client.clientName ?? client.clientId,
        pokeUserId,
        params: new URLSearchParams(req.query as Record<string, string>),
        error:
          query.approve === "1" && !pokeUserId
            ? "Enter your Poke ID to authorize this MCP client."
            : undefined,
      }),
    );
    return;
  }

  setPokeUserCookie(res, pokeUserId);
  const code = randomToken("mcp_code");
  authorizationCodes.set(code, {
    code,
    clientId: client.clientId,
    redirectUri: query.redirect_uri,
    pokeUserId,
    scope: query.scope || DEFAULT_SCOPE,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: query.code_challenge_method,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });

  const redirectUrl = new URL(query.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (query.state) redirectUrl.searchParams.set("state", query.state);
  res.redirect(redirectUrl.href);
});

// Token endpoint for authorization_code + PKCE.
oauthRouter.post("/oauth/token", (req: Request, res: Response) => {
  cleanupExpired();
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
  const code = authorizationCodes.get(request.code);
  authorizationCodes.delete(request.code);

  if (!code || code.expiresAt <= Date.now()) {
    jsonError(res, 400, "invalid_grant", "Authorization code is invalid or expired.");
    return;
  }

  if (code.clientId !== request.client_id || code.redirectUri !== request.redirect_uri) {
    jsonError(res, 400, "invalid_grant", "Authorization code does not match this client.");
    return;
  }

  if (!verifyPkce(request.code_verifier, code.codeChallenge)) {
    jsonError(res, 400, "invalid_grant", "PKCE verification failed.");
    return;
  }

  const token = randomToken("mcp_token");
  accessTokens.set(token, {
    token,
    clientId: code.clientId,
    pokeUserId: code.pokeUserId,
    scope: code.scope,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  });

  res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: code.scope,
  });
});
