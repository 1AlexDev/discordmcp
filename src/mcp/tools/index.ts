import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveGuildForPokeUser, GuildResolverError } from "../../db/guild-resolver.js";
import { discordManager } from "../../discord/DiscordManager.js";
import { formatToolResult, errorResult } from "../errors.js";
import { getCurrentPokeUserId } from "../request-context.js";
import type { ToolResult } from "../../types/schemas.js";

/** Wraps a tool handler with guild resolution and standardized error responses. */
async function withGuild<T>(
  action: (guildId: string) => Promise<ToolResult<T>>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const pokeUserId = getCurrentPokeUserId();
    const link = await resolveGuildForPokeUser(pokeUserId);
    const result = await action(link.discord_guild_id);
    return { content: [{ type: "text", text: formatToolResult(result) }] };
  } catch (err) {
    if (err instanceof GuildResolverError) {
      return {
        content: [
          {
            type: "text",
            text: formatToolResult(errorResult(err.code, err.message)),
          },
        ],
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: formatToolResult(errorResult("UNKNOWN", message)),
        },
      ],
    };
  }
}

/** Registers all Discord MCP tools on the given server instance. */
export function registerDiscordTools(server: McpServer): void {
  server.registerTool(
    "list_channels",
    {
      description:
        "Returns a list of channels in the Discord server linked to the current Poke user.",
      inputSchema: {},
    },
    async () => withGuild((guildId) => discordManager.listChannels(guildId))
  );

  server.registerTool(
    "send_message",
    {
      description: "Sends a message to a specific text channel in the linked Discord server.",
      inputSchema: {
        channelId: z.string().describe("Discord channel ID to send the message to"),
        content: z.string().max(2000).describe("Message content (max 2000 characters)"),
      },
    },
    async ({ channelId, content }) =>
      withGuild((guildId) => discordManager.sendMessage(guildId, channelId, content))
  );

  server.registerTool(
    "create_channel",
    {
      description: "Creates a new text or voice channel in the linked Discord server.",
      inputSchema: {
        name: z.string().max(100).describe("Channel name"),
        type: z.enum(["text", "voice"]).describe("Channel type: text or voice"),
        parentId: z
          .string()
          .optional()
          .describe("Optional category (parent channel) ID"),
      },
    },
    async ({ name, type, parentId }) =>
      withGuild((guildId) => discordManager.createChannel(guildId, name, type, parentId))
  );

  server.registerTool(
    "kick_user",
    {
      description: "Kicks a user from the linked Discord server by their user ID.",
      inputSchema: {
        userId: z.string().describe("Discord user ID to kick"),
        reason: z.string().max(512).optional().describe("Optional kick reason"),
      },
    },
    async ({ userId, reason }) =>
      withGuild((guildId) => discordManager.kickUser(guildId, userId, reason))
  );

  server.registerTool(
    "ban_user",
    {
      description: "Bans a user from the linked Discord server by their user ID.",
      inputSchema: {
        userId: z.string().describe("Discord user ID to ban"),
        reason: z.string().max(512).optional().describe("Optional ban reason"),
        deleteMessageDays: z
          .number()
          .int()
          .min(0)
          .max(7)
          .optional()
          .describe("Number of days of messages to delete (0-7)"),
      },
    },
    async ({ userId, reason, deleteMessageDays }) =>
      withGuild((guildId) =>
        discordManager.banUser(guildId, userId, reason, deleteMessageDays)
      )
  );

  server.registerTool(
    "create_role",
    {
      description:
        "Creates a new role in the linked Discord server with optional color and permissions.",
      inputSchema: {
        name: z.string().max(100).describe("Role name"),
        color: z
          .number()
          .int()
          .min(0)
          .max(0xffffff)
          .optional()
          .describe("Role color as a decimal RGB value (e.g. 16711680 for red)"),
        permissions: z
          .string()
          .optional()
          .describe("Permission bitfield as a string (Discord permissions integer)"),
      },
    },
    async ({ name, color, permissions }) =>
      withGuild((guildId) => discordManager.createRole(guildId, name, color, permissions))
  );

  server.registerTool(
    "assign_role",
    {
      description: "Assigns a role to a user in the linked Discord server.",
      inputSchema: {
        userId: z.string().describe("Discord user ID to receive the role"),
        roleId: z.string().describe("Discord role ID to assign"),
      },
    },
    async ({ userId, roleId }) =>
      withGuild((guildId) => discordManager.assignRole(guildId, userId, roleId))
  );
}

/** Tool count for startup logging. */
export const TOOL_COUNT = 7;
