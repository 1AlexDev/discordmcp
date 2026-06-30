import { getAccountLinksByPokeUserId } from "./supabase.js";
import type { AccountLink, ToolResult } from "../types/schemas.js";

export class GuildResolverError extends Error {
  constructor(
    public readonly code: Extract<ToolResult, { success: false }>["code"],
    message: string,
  ) {
    super(message);
    this.name = "GuildResolverError";
  }
}

/**
 * Resolves a Poke user ID to a linked Discord guild.
 * If multiple guilds are linked, the most recently updated link is used.
 * Throws GuildResolverError with NOT_LINKED when no mapping exists.
 */
export async function resolveGuildForPokeUser(
  pokeUserId: string,
): Promise<AccountLink> {
  const links = await getAccountLinksByPokeUserId(pokeUserId);
  const link = links[0];

  if (!link) {
    throw new GuildResolverError(
      "NOT_LINKED",
      `No Discord server is linked for Poke user "${pokeUserId}". ` +
        "The user must log in via /auth/login and link a Discord server via /auth/link first.",
    );
  }

  return link;
}
