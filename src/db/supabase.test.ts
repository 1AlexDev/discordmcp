import assert from "node:assert/strict";
import test from "node:test";

process.env.DISCORD_CLIENT_ID ??= "test-client-id";
process.env.DISCORD_CLIENT_SECRET ??= "test-client-secret";
process.env.DISCORD_TOKEN ??= "test-bot-token";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.BASE_URL ??= "https://example.com";

const { buildAccountLinkInsertRow, upsertAccountLinkRecord } = await import(
  "./supabase.js",
);

class FakeQuery {
  public calls: string[] = [];
  private readonly chain: string[];
  private readonly maybeSingleResult: { data: unknown; error: { message: string } | null };
  private readonly singleResult: { data: unknown; error: { message: string } | null };

  constructor(
    chain: string[],
    maybeSingleResult: { data: unknown; error: { message: string } | null },
    singleResult: { data: unknown; error: { message: string } | null } = maybeSingleResult,
  ) {
    this.chain = chain;
    this.maybeSingleResult = maybeSingleResult;
    this.singleResult = singleResult;
  }

  select(_columns?: string) {
    this.calls.push(`${this.chain.join(".")}:select`);
    return this;
  }

  eq(column: string, _value: unknown) {
    this.calls.push(`${this.chain.join(".")}:eq:${column}`);
    return this;
  }

  limit(_count: number) {
    this.calls.push(`${this.chain.join(".")}:limit`);
    return this;
  }

  maybeSingle() {
    this.calls.push(`${this.chain.join(".")}:maybeSingle`);
    return Promise.resolve(this.maybeSingleResult);
  }

  update(_values: unknown) {
    this.calls.push(`${this.chain.join(".")}:update`);
    return this;
  }

  insert(_values: unknown) {
    this.calls.push(`${this.chain.join(".")}:insert`);
    return this;
  }

  single() {
    this.calls.push(`${this.chain.join(".")}:single`);
    return Promise.resolve(this.singleResult);
  }
}

test("buildAccountLinkInsertRow maps OAuth input into a Supabase-friendly row", () => {
  const row = buildAccountLinkInsertRow({
    pokeUserId: "poke-123",
    discordUserId: "discord-456",
    discordGuildId: "guild-789",
    discordUsername: "Example User",
    accessToken: "token-abc",
    refreshToken: "refresh-def",
    tokenExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
    botPermissions: 123n,
  });

  assert.equal(row.poke_user_id, "poke-123");
  assert.equal(row.discord_user_id, "discord-456");
  assert.equal(row.discord_guild_id, "guild-789");
  assert.equal(row.discord_username, "Example User");
  assert.equal(row.access_token, "token-abc");
  assert.equal(row.refresh_token, "refresh-def");
  assert.equal(row.token_expires_at, "2026-01-01T00:00:00.000Z");
  assert.equal(row.bot_permissions, 123);
});

test("upsertAccountLinkRecord updates an existing link row rather than inserting a duplicate", async () => {
  const fakeClient = {
    from(table: string) {
      if (table !== "discord_account_links") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return new FakeQuery(
        ["from"],
        {
          data: {
            id: "link-1",
            poke_user_id: "poke-123",
            discord_user_id: "discord-456",
            discord_guild_id: "guild-789",
            discord_username: "Example User",
            access_token: "old-token",
            refresh_token: null,
            token_expires_at: null,
            bot_permissions: null,
            linked_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          error: null,
        },
        {
          data: {
            id: "link-1",
            poke_user_id: "poke-123",
            discord_user_id: "discord-456",
            discord_guild_id: "guild-789",
            discord_username: "Example User",
            access_token: "new-token",
            refresh_token: null,
            token_expires_at: null,
            bot_permissions: null,
            linked_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          error: null,
        },
      );
    },
  };

  const result = await upsertAccountLinkRecord(fakeClient as never, {
    pokeUserId: "poke-123",
    discordUserId: "discord-456",
    discordGuildId: "guild-789",
    discordUsername: "Example User",
    accessToken: "new-token",
  });

  assert.equal(result.access_token, "new-token");
});
