import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import type { AccountLink } from "../types/schemas.js";

/** Supabase table name for Discord account links. */
export const ACCOUNT_LINKS_TABLE = "discord_account_links";
export const AUTOMATION_SCRIPTS_TABLE = "automation_scripts";

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

export interface AutomationScript {
  id: string;
  poke_user_id: string;
  discord_guild_id: string;
  event_type: string;
  trigger_id: string | null;
  actions: unknown[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface AutomationScriptRow {
  id: string;
  poke_user_id: string;
  discord_guild_id: string;
  event_type: string;
  trigger_id: string | null;
  actions: unknown;
  active: boolean;
  created_at: string;
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

function rowToAutomationScript(row: AutomationScriptRow): AutomationScript {
  return {
    id: row.id,
    poke_user_id: row.poke_user_id,
    discord_guild_id: row.discord_guild_id,
    event_type: row.event_type,
    trigger_id: row.trigger_id,
    actions: Array.isArray(row.actions) ? row.actions : [],
    active: row.active,
    created_at: row.created_at,
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

export async function isGuildLinkedToPokeUser(
  pokeUserId: string,
  guildId: string,
): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(ACCOUNT_LINKS_TABLE)
    .select("id")
    .eq("poke_user_id", pokeUserId)
    .eq("discord_guild_id", guildId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify account link: ${error.message}`);
  }

  return Boolean(data);
}

export interface CreateAutomationScriptInput {
  pokeUserId: string;
  discordGuildId: string;
  eventType: string;
  triggerId?: string | null;
  actions: unknown[];
}

export type UpdateAutomationScriptInput = {
  pokeUserId: string;
  discordGuildId: string;
  eventType: string;
  triggerId?: string | null;
  actions: Record<string, unknown>[];
  active?: boolean;
};

export async function updateAutomationScript(
  scriptId: string,
  input: UpdateAutomationScriptInput,
): Promise<AutomationScript> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(AUTOMATION_SCRIPTS_TABLE)
    .update({
      event_type: input.eventType,
      trigger_id: input.triggerId ?? null,
      actions: input.actions,
      active: input.active ?? true,
    })
    .eq("id", scriptId)
    .eq("poke_user_id", input.pokeUserId)
    .eq("discord_guild_id", input.discordGuildId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update automation script: ${error.message}`);
  }

  return rowToAutomationScript(data as AutomationScriptRow);
}

export async function createAutomationScript(
  input: CreateAutomationScriptInput,
): Promise<AutomationScript> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(AUTOMATION_SCRIPTS_TABLE)
    .insert({
      poke_user_id: input.pokeUserId,
      discord_guild_id: input.discordGuildId,
      event_type: input.eventType,
      trigger_id: input.triggerId ?? null,
      actions: input.actions,
      active: true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create automation script: ${error.message}`);
  }

  return rowToAutomationScript(data as AutomationScriptRow);
}

export async function getAutomationScriptsByGuild(
  pokeUserId: string,
  guildId: string,
): Promise<AutomationScript[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(AUTOMATION_SCRIPTS_TABLE)
    .select("*")
    .eq("poke_user_id", pokeUserId)
    .eq("discord_guild_id", guildId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch automation scripts: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    rowToAutomationScript(row as AutomationScriptRow),
  );
}

export async function getActiveAutomationScriptsForTrigger(
  guildId: string,
  eventType: string,
  triggerId?: string | null,
): Promise<AutomationScript[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(AUTOMATION_SCRIPTS_TABLE)
    .select("*")
    .eq("discord_guild_id", guildId)
    .eq("event_type", eventType)
    .eq("active", true);

  if (error) {
    throw new Error(
      `Failed to fetch active automation scripts: ${error.message}`,
    );
  }

  const normalizedTrigger = triggerId ?? null;
  return (data ?? [])
    .map((row) => rowToAutomationScript(row as AutomationScriptRow))
    .filter(
      (script) =>
        script.trigger_id === normalizedTrigger ||
        script.trigger_id === "*" ||
        script.trigger_id == null,
    );
}

export async function getAutomationScriptById(
  scriptId: string,
): Promise<AutomationScript | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from(AUTOMATION_SCRIPTS_TABLE)
    .select("*")
    .eq("id", scriptId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch automation script: ${error.message}`);
  }

  return data ? rowToAutomationScript(data as AutomationScriptRow) : null;
}

export async function deleteAutomationScript(
  scriptId: string,
  pokeUserId?: string,
): Promise<boolean> {
  const supabase = getSupabase();
  let query = supabase
    .from(AUTOMATION_SCRIPTS_TABLE)
    .delete()
    .eq("id", scriptId);

  if (pokeUserId) {
    query = query.eq("poke_user_id", pokeUserId);
  }

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    throw new Error(`Failed to delete automation script: ${error.message}`);
  }

  return Boolean(data);
}
