import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveGuildForPokeUser,
  GuildResolverError,
} from "../../db/guild-resolver.js";
import { discordManager } from "../../discord/DiscordManager.js";
import { formatToolResult, errorResult } from "../errors.js";
import { getCurrentPokeUserId } from "../request-context.js";
import type { ToolResult } from "../../types/schemas.js";

/** Wraps a tool handler with guild resolution and standardized error responses. */
async function withGuild<T>(
  action: (guildId: string) => Promise<ToolResult<T>>,
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
    async () => withGuild((guildId) => discordManager.listChannels(guildId)),
  );

  server.registerTool(
    "send_message",
    {
      description:
        "Sends a message to a specific text channel in the linked Discord server.",
      inputSchema: {
        channelId: z
          .string()
          .describe("Discord channel ID to send the message to"),
        content: z
          .string()
          .max(2000)
          .describe("Message content (max 2000 characters)"),
      },
    },
    async ({ channelId, content }) =>
      withGuild((guildId) =>
        discordManager.sendMessage(guildId, channelId, content),
      ),
  );

  server.registerTool(
    "create_channel",
    {
      description:
        "Creates a new text or voice channel in the linked Discord server.",
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
      withGuild((guildId) =>
        discordManager.createChannel(guildId, name, type, parentId),
      ),
  );

  server.registerTool(
    "kick_user",
    {
      description:
        "Kicks a user from the linked Discord server by their user ID.",
      inputSchema: {
        userId: z.string().describe("Discord user ID to kick"),
        reason: z.string().max(512).optional().describe("Optional kick reason"),
      },
    },
    async ({ userId, reason }) =>
      withGuild((guildId) => discordManager.kickUser(guildId, userId, reason)),
  );

  server.registerTool(
    "ban_user",
    {
      description:
        "Bans a user from the linked Discord server by their user ID.",
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
        discordManager.banUser(guildId, userId, reason, deleteMessageDays),
      ),
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
          .describe(
            "Role color as a decimal RGB value (e.g. 16711680 for red)",
          ),
        permissions: z
          .string()
          .optional()
          .describe(
            "Permission bitfield as a string (Discord permissions integer)",
          ),
      },
    },
    async ({ name, color, permissions }) =>
      withGuild((guildId) =>
        discordManager.createRole(guildId, name, color, permissions),
      ),
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
      withGuild((guildId) =>
        discordManager.assignRole(guildId, userId, roleId),
      ),
  );

  server.registerTool(
    "get_users",
    {
      description: "Fetches a list of members in the linked Discord server.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Optional username or display name to search for"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of users to return (default 25, max 100)"),
      },
    },
    async ({ query, limit }) =>
      withGuild((guildId) => discordManager.getUsers(guildId, query, limit)),
  );

  server.registerTool(
    "get_roles",
    {
      description:
        "Fetches all available roles in the linked Discord server and their IDs.",
      inputSchema: {},
    },
    async () => withGuild((guildId) => discordManager.getRoles(guildId)),
  );

  server.registerTool(
    "read_messages",
    {
      description:
        "Reads the most recent messages from a specific text channel in the linked Discord server.",
      inputSchema: {
        channelId: z
          .string()
          .describe("Discord channel ID to read messages from"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Maximum number of messages to return (default 20, max 50)",
          ),
      },
    },
    async ({ channelId, limit }) =>
      withGuild((guildId) =>
        discordManager.readMessages(guildId, channelId, limit),
      ),
  );

  server.registerTool(
    "get_server_info",
    {
      description:
        "Returns high-level information and statistics about the linked Discord server.",
      inputSchema: {},
    },
    async () => withGuild((guildId) => discordManager.getServerInfo(guildId)),
  );
  server.registerTool(
    "get_categories",
    {
      description:
        "Fetches a list of all categories in the linked Discord server and their IDs.",
      inputSchema: {},
    },
    async () => withGuild((guildId) => discordManager.getCategories(guildId)),
  );

  server.registerTool(
    "delete_category",
    {
      description: "Deletes a category in the linked Discord server.",
      inputSchema: {
        categoryId: z.string().describe("Discord category ID to delete"),
      },
    },
    async ({ categoryId }) =>
      withGuild((guildId) =>
        discordManager.deleteCategory(guildId, categoryId),
      ),
  );

  server.registerTool(
    "get_channel",
    {
      description:
        "Fetches detailed information about a specific channel in the linked Discord server.",
      inputSchema: {
        channelId: z
          .string()
          .describe("Discord channel ID to fetch details for"),
      },
    },
    async ({ channelId }) =>
      withGuild((guildId) => discordManager.getChannel(guildId, channelId)),
  );

  server.registerTool(
    "delete_channel",
    {
      description: "Deletes a channel in the linked Discord server.",
      inputSchema: {
        channelId: z.string().describe("Discord channel ID to delete"),
      },
    },
    async ({ channelId }) =>
      withGuild((guildId) => discordManager.deleteChannel(guildId, channelId)),
  );

  server.registerTool(
    "update_channel",
    {
      description:
        "Updates properties of an existing channel in the linked Discord server.",
      inputSchema: {
        channelId: z.string().describe("Discord channel ID to update"),
        name: z.string().max(100).optional().describe("New channel name"),
        topic: z
          .string()
          .max(1024)
          .optional()
          .describe("New channel topic (text channels only)"),
        parentId: z
          .string()
          .optional()
          .describe("New category (parent channel) ID"),
      },
    },
    async ({ channelId, ...options }) =>
      withGuild((guildId) =>
        discordManager.updateChannel(guildId, channelId, options),
      ),
  );

  server.registerTool(
    "send_embed_message",
    {
      description:
        "Sends a rich embed message to a specific text channel in the linked Discord server.",
      inputSchema: {
        channelId: z
          .string()
          .describe("Discord channel ID to send the embed to"),
        title: z.string().max(256).optional().describe("Embed title"),
        description: z
          .string()
          .max(4096)
          .optional()
          .describe("Embed description"),
        color: z
          .number()
          .int()
          .min(0)
          .max(0xffffff)
          .optional()
          .describe(
            "Embed color as a decimal RGB value (e.g. 16711680 for red)",
          ),
        fields: z
          .array(
            z.object({
              name: z.string().max(256),
              value: z.string().max(1024),
              inline: z.boolean().optional(),
            }),
          )
          .max(25)
          .optional()
          .describe("Embed fields"),
        footer: z.string().max(2048).optional().describe("Embed footer text"),
      },
    },
    async ({ channelId, ...embedData }) =>
      withGuild((guildId) =>
        discordManager.sendEmbedMessage(guildId, channelId, embedData),
      ),
  );

  server.registerTool(
    "send_component_message",
    {
      description:
        "Sends a message with interactive components (buttons, select menus) to a specific text channel in the linked Discord server.",
      inputSchema: {
        channelId: z
          .string()
          .describe("Discord channel ID to send the message to"),
        content: z.string().max(2000).describe("Message text content"),
        components: z
          .array(
            z.object({
              type: z.enum(["button", "select"]),
              customId: z.string().max(100),
              label: z.string().max(80).optional(),
              style: z
                .number()
                .int()
                .min(1)
                .max(5)
                .optional()
                .describe(
                  "Button style (1: Primary, 2: Secondary, 3: Success, 4: Danger, 5: Link)",
                ),
              options: z
                .array(
                  z.object({
                    label: z.string().max(100),
                    value: z.string().max(100),
                    description: z.string().max(100).optional(),
                  }),
                )
                .max(25)
                .optional()
                .describe("Select menu options"),
              placeholder: z
                .string()
                .max(150)
                .optional()
                .describe("Select menu placeholder text"),
            }),
          )
          .max(5)
          .describe("Array of components (max 5)"),
      },
    },
    async ({ channelId, content, components }) =>
      withGuild((guildId) =>
        discordManager.sendComponentMessage(
          guildId,
          channelId,
          content,
          components,
        ),
      ),
  );
}

/** Tool count for startup logging. */
export const TOOL_COUNT = 18;
