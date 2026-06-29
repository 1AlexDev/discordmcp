import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { AccountLink } from "../types/schemas.js";

/** Supabase table name for Discord account links. */
export const ACCOUNT_LINKS_TABLE = "discord_account_links";

/** Row type for the discord_account_links table. */
export interface AccountLinkRow {
  id: string;
  poke_user_id: string;
  discord_user_id: string;
  discord_guild_id: string;
  discord_username: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  bot_permissions: number | null;
  linked_at: string;
  updated_at: string;
}

let client: SupabaseClient | null = null;

/** Returns a singleton Supabase client using the service role key. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Maps a database row to the application AccountLink type. */
export function rowToAccountLink(row: AccountLinkRow): AccountLink {
  return {
    id: row.id,
    poke_user_id: row.poke_user_id,
    discord_user_id: row.discord_user_id,
    discord_guild_id: row.discord_guild_id,
    discord_username: row.discord_username,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    token_expires_at: row.token_expires_at,
    bot_permissions: row.bot_permissions,
    linked_at: row.linked_at,
    updated_at: row.updated_at,
  };
}

export interface UpsertAccountLinkInput {
  pokeUserId: string;
  discordUserId: string;
  discordGuildId: string;
  discordUsername?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  botPermissions?: bigint;
}

/** Creates or updates a Discord account link for a Poke user. */
export async function upsertAccountLink(
  input: UpsertAccountLinkInput,
): Promise<AccountLink> {
  const supabase = getSupabase();

  const row = {
    poke_user_id: input.pokeUserId,
    discord_user_id: input.discordUserId,
    discord_guild_id: input.discordGuildId,
    discord_username: input.discordUsername ?? null,
    access_token: input.accessToken,
    refresh_token: input.refreshToken ?? null,
    token_expires_at: input.tokenExpiresAt?.toISOString() ?? null,
    bot_permissions:
      input.botPermissions != null ? Number(input.botPermissions) : null,
  };

  const { data, error } = await supabase
    .from(ACCOUNT_LINKS_TABLE)
    .upsert(row, { onConflict: "poke_user_id,discord_guild_id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to upsert account link: ${error.message}`);
  }

  return rowToAccountLink(data as AccountLinkRow);
}

/** Fetches an account link by Poke user ID. Returns null if not linked. */
export async function getAccountLinkByPokeUserId(
  pokeUserId: string,
): Promise<AccountLink | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(ACCOUNT_LINKS_TABLE)
    .select("*")
    .eq("poke_user_id", pokeUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch account link: ${error.message}`);
  }

  if (!data) return null;
  return rowToAccountLink(data as AccountLinkRow);
}

/** Fetches all account links for a Poke user, newest updated first. */
export async function getAccountLinksByPokeUserId(
  pokeUserId: string,
): Promise<AccountLink[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(ACCOUNT_LINKS_TABLE)
    .select("*")
    .eq("poke_user_id", pokeUserId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch account links: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToAccountLink(row as AccountLinkRow));
}

/** Deletes all account links for a Poke user. Used by dashboard logout/disconnect. */
export async function deleteAccountLinksByPokeUserId(
  pokeUserId: string,
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from(ACCOUNT_LINKS_TABLE)
    .delete()
    .eq("poke_user_id", pokeUserId);

  if (error) {
    throw new Error(`Failed to delete account links: ${error.message}`);
  }
}
