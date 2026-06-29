import { getAccountLinkByPokeUserId } from "./supabase.js";
import type { AccountLink, ToolResult } from "../types/schemas.js";

export class GuildResolverError extends Error {
  constructor(
    public readonly code: Extract<ToolResult, { success: false }>["code"],
    message: string
  ) {
    super(message);
    this.name = "GuildResolverError";
  }
}

/**
 * Resolves a Poke user ID to their linked Discord guild.
 * Throws GuildResolverError with NOT_LINKED when no mapping exists.
 */
export async function resolveGuildForPokeUser(
  pokeUserId: string
): Promise<AccountLink> {
  const link = await getAccountLinkByPokeUserId(pokeUserId);

  if (!link) {
    throw new GuildResolverError(
      "NOT_LINKED",
      `No Discord server is linked for Poke user "${pokeUserId}". ` +
        "The user must complete OAuth linking via /auth first."
    );
  }

  return link;
}
