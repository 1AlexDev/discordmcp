import { z } from "zod";

/** Shared pokeUserId field required on every MCP tool. */
export const pokeUserIdSchema = z.string().min(1, "pokeUserId is required");

/** Database row shape for discord_account_links. */
export const accountLinkSchema = z.object({
  id: z.string().uuid(),
  poke_user_id: z.string(),
  discord_user_id: z.string(),
  discord_guild_id: z.string(),
  discord_username: z.string().nullable(),
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  token_expires_at: z.string().nullable(),
  bot_permissions: z.number().nullable(),
  linked_at: z.string(),
  updated_at: z.string(),
});

export type AccountLink = z.infer<typeof accountLinkSchema>;

/** Standard MCP tool response envelope. */
export const toolResultSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    success: z.literal(false),
    code: z.enum([
      "NOT_LINKED",
      "MISSING_PERMISSION",
      "RATE_LIMITED",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "BOT_NOT_IN_GUILD",
      "UNKNOWN",
    ]),
    message: z.string(),
  }),
]);

export type ToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; code: string; message: string };

// --- MCP tool input schemas ---

export const listChannelsInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
});

export const sendMessageInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
  channelId: z.string().min(1),
  content: z.string().min(1).max(2000),
});

export const createChannelInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
  name: z.string().min(1).max(100),
  type: z.enum(["text", "voice"]),
  parentId: z.string().optional(),
});

export const kickUserInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
  userId: z.string().min(1),
  reason: z.string().max(512).optional(),
});

export const banUserInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
  userId: z.string().min(1),
  reason: z.string().max(512).optional(),
  deleteMessageDays: z.number().int().min(0).max(7).optional(),
});

export const createRoleInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
  name: z.string().min(1).max(100),
  color: z.number().int().min(0).max(0xffffff).optional(),
  permissions: z.string().optional(),
});

export const assignRoleInputSchema = z.object({
  pokeUserId: pokeUserIdSchema,
  userId: z.string().min(1),
  roleId: z.string().min(1),
});
