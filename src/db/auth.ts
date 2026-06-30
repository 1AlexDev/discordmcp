import { randomBytes } from "node:crypto";
import { getSupabase } from "./supabase.js";

export const APP_USERS_TABLE = "app_users";
export const USER_SESSIONS_TABLE = "user_sessions";
export const OAUTH_CLIENTS_TABLE = "oauth_clients";
export const OAUTH_AUTH_CODES_TABLE = "oauth_authorization_codes";
export const OAUTH_ACCESS_TOKENS_TABLE = "oauth_access_tokens";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AppUser {
  id: string;
  discord_username: string | null;
  discord_global_name: string | null;
  discord_avatar: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSession {
  id: string;
  session_token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface OAuthClientRecord {
  client_id: string;
  client_secret: string | null;
  client_name: string | null;
  redirect_uris: string[];
  created_at: string;
}

export interface OAuthAuthorizationCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  user_id: string;
  scope: string;
  code_challenge: string;
  expires_at: string;
}

export interface OAuthAccessTokenRecord {
  token: string;
  client_id: string;
  user_id: string;
  scope: string;
  expires_at: string;
}

function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export interface UpsertAppUserInput {
  discordUserId: string;
  discordUsername?: string;
  discordGlobalName?: string | null;
  discordAvatar?: string | null;
}

/** Creates or updates a user from Discord OAuth profile data. */
export async function upsertAppUser(
  input: UpsertAppUserInput,
): Promise<AppUser> {
  const supabase = getSupabase();

  const row = {
    id: input.discordUserId,
    discord_username: input.discordUsername ?? null,
    discord_global_name: input.discordGlobalName ?? null,
    discord_avatar: input.discordAvatar ?? null,
  };

  const { data, error } = await supabase
    .from(APP_USERS_TABLE)
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert app user: ${error.message}`);
  }

  return data as AppUser;
}

/** Creates a new web session for a user and returns the session token. */
export async function createUserSession(userId: string): Promise<string> {
  const supabase = getSupabase();
  const sessionToken = randomToken("sess");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error } = await supabase.from(USER_SESSIONS_TABLE).insert({
    session_token: sessionToken,
    user_id: userId,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create user session: ${error.message}`);
  }

  return sessionToken;
}

/** Resolves a session token to a user ID if valid and not expired. */
export async function getUserIdFromSessionToken(
  sessionToken: string,
): Promise<string | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(USER_SESSIONS_TABLE)
    .select("user_id, expires_at")
    .eq("session_token", sessionToken)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to lookup session: ${error.message}`);
  }

  if (!data) return null;

  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await supabase
      .from(USER_SESSIONS_TABLE)
      .delete()
      .eq("session_token", sessionToken);
    return null;
  }

  return data.user_id as string;
}

/** Deletes a session (logout). */
export async function deleteUserSession(sessionToken: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from(USER_SESSIONS_TABLE)
    .delete()
    .eq("session_token", sessionToken);

  if (error) {
    throw new Error(`Failed to delete session: ${error.message}`);
  }
}

/** Deletes all sessions for a user. */
export async function deleteUserSessions(userId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from(USER_SESSIONS_TABLE)
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete user sessions: ${error.message}`);
  }
}

export async function registerOAuthClient(input: {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
}): Promise<OAuthClientRecord> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(OAUTH_CLIENTS_TABLE)
    .insert({
      client_id: input.clientId,
      client_name: input.clientName ?? null,
      redirect_uris: input.redirectUris,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to register OAuth client: ${error.message}`);
  }

  return data as OAuthClientRecord;
}

export async function getOAuthClient(
  clientId: string,
): Promise<OAuthClientRecord | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(OAUTH_CLIENTS_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch OAuth client: ${error.message}`);
  }

  return data as OAuthClientRecord | null;
}

export async function storeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  userId: string;
  scope: string;
  codeChallenge: string;
}): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from(OAUTH_AUTH_CODES_TABLE).insert({
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    user_id: input.userId,
    scope: input.scope,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });

  if (error) {
    throw new Error(`Failed to store authorization code: ${error.message}`);
  }
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<OAuthAuthorizationCode | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(OAUTH_AUTH_CODES_TABLE)
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch authorization code: ${error.message}`);
  }

  await supabase.from(OAUTH_AUTH_CODES_TABLE).delete().eq("code", code);

  if (!data) return null;

  const record = data as OAuthAuthorizationCode;
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return record;
}

export async function storeAccessToken(input: {
  token: string;
  clientId: string;
  userId: string;
  scope: string;
}): Promise<OAuthAccessTokenRecord> {
  const supabase = getSupabase();

  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from(OAUTH_ACCESS_TOKENS_TABLE)
    .insert({
      token: input.token,
      client_id: input.clientId,
      user_id: input.userId,
      scope: input.scope,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to store access token: ${error.message}`);
  }

  return data as OAuthAccessTokenRecord;
}

export async function getUserIdFromAccessToken(
  token: string,
): Promise<string | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(OAUTH_ACCESS_TOKENS_TABLE)
    .select("user_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch access token: ${error.message}`);
  }

  if (!data) return null;

  if (new Date(data.expires_at as string).getTime() <= Date.now()) {
    await supabase.from(OAUTH_ACCESS_TOKENS_TABLE).delete().eq("token", token);
    return null;
  }

  return data.user_id as string;
}

/** Removes expired OAuth codes and tokens (best-effort cleanup). */
export async function cleanupExpiredOAuthRecords(): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  await supabase
    .from(OAUTH_AUTH_CODES_TABLE)
    .delete()
    .lt("expires_at", now);

  await supabase
    .from(OAUTH_ACCESS_TOKENS_TABLE)
    .delete()
    .lt("expires_at", now);

  await supabase.from(USER_SESSIONS_TABLE).delete().lt("expires_at", now);
}

export { randomToken, ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS };
