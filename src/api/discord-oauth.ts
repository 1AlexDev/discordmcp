import {
  env,
  discordRedirectUri,
  DISCORD_BOT_PERMISSIONS,
} from "../config/env.js";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL = "https://discord.com/api/users/@me";
const DISCORD_OAUTH_BASE = "https://discord.com/api/oauth2/authorize";

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface DiscordUserProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

/** Exchanges a Discord authorization code for tokens. */
export async function exchangeDiscordCode(
  code: string,
): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: discordRedirectUri,
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Discord token exchange failed (${response.status}): ${text}`,
    );
  }

  return response.json() as Promise<DiscordTokenResponse>;
}

/** Fetches the Discord user profile for an access token. */
export async function fetchDiscordUserProfile(
  accessToken: string,
): Promise<DiscordUserProfile> {
  const response = await fetch(DISCORD_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord user fetch failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<DiscordUserProfile>;
}

export type DiscordOAuthScope = "login" | "link_guild";

/** Builds a Discord OAuth authorization URL for login or guild linking. */
export function buildDiscordOAuthUrl(
  state: string,
  scope: DiscordOAuthScope,
): string {
  const scopes =
    scope === "link_guild" ? "identify guilds bot" : "identify guilds";

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: discordRedirectUri,
    response_type: "code",
    scope: scopes,
    state,
  });

  if (scope === "link_guild") {
    params.set("permissions", DISCORD_BOT_PERMISSIONS.toString());
  }

  return `${DISCORD_OAUTH_BASE}?${params.toString()}`;
}
