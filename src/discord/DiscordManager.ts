import {
  type Guild,
  ChannelType,
  PermissionsBitField,
  type TextChannel,
} from "discord.js";
import {
  getDiscordClient,
  waitForDiscordReady,
  parsePermissions,
} from "./client.js";
import { errorResult, mapDiscordError, successResult } from "../mcp/errors.js";
import type { ToolResult } from "../types/schemas.js";

export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number;
}

export interface RoleSummary {
  id: string;
  name: string;
  color: number;
}

export interface MessageSummary {
  id: string;
  channelId: string;
  content: string;
}

/**
 * Central service for all Discord bot actions.
 * Every method operates within a specific guild ID resolved from Supabase.
 */
export class DiscordManager {
  /** Fetches a guild and verifies the bot is a member. */
  private async getGuild(
    guildId: string
  ): Promise<Guild | Extract<ToolResult, { success: false }>> {
    await waitForDiscordReady();
    const client = getDiscordClient();
    const guild =
      client.guilds.cache.get(guildId) ??
      (await client.guilds.fetch(guildId).catch(() => null));

    if (!guild) {
      return errorResult(
        "BOT_NOT_IN_GUILD",
        `Bot is not present in guild ${guildId}. The user may need to re-invite the bot.`
      );
    }

    return guild;
  }

  private isErrorResult(
    value: Guild | Extract<ToolResult, { success: false }>
  ): value is Extract<ToolResult, { success: false }> {
    return "success" in value && value.success === false;
  }

  /** Lists all channels in the guild. */
  async listChannels(guildId: string): Promise<ToolResult<ChannelSummary[]>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channels = await guild.channels.fetch();

      const summaries: ChannelSummary[] = [];
      for (const channel of channels.values()) {
        if (!channel) continue;

        summaries.push({
          id: channel.id,
          name: channel.name,
          type: ChannelTypeLabel(channel.type),
          parentId: channel.parentId,
          position: getChannelPosition(channel),
        });
      }

      summaries.sort((a, b) => a.position - b.position);
      return successResult(summaries);
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Sends a message to a text channel in the guild. */
  async sendMessage(
    guildId: string,
    channelId: string,
    content: string
  ): Promise<ToolResult<MessageSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return errorResult("NOT_FOUND", `Channel ${channelId} is not a text channel in this guild.`);
      }

      const textChannel = channel as TextChannel;
      const message = await textChannel.send({ content });

      return successResult({
        id: message.id,
        channelId: message.channelId,
        content: message.content,
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Creates a new text or voice channel. */
  async createChannel(
    guildId: string,
    name: string,
    type: "text" | "voice",
    parentId?: string
  ): Promise<ToolResult<ChannelSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel =
        type === "voice"
          ? await guild.channels.create({
              name,
              type: ChannelType.GuildVoice,
              parent: parentId,
            })
          : await guild.channels.create({
              name,
              type: ChannelType.GuildText,
              parent: parentId,
            });

      return successResult({
        id: channel.id,
        name: channel.name,
        type,
        parentId: channel.parentId,
        position: channel.position,
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Kicks a member from the guild. */
  async kickUser(
    guildId: string,
    userId: string,
    reason?: string
  ): Promise<ToolResult<{ userId: string; action: "kicked" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return errorResult("NOT_FOUND", `User ${userId} is not a member of this guild.`);
      }

      await member.kick(reason ?? "Kicked via Poke Discord MCP");

      return successResult({ userId, action: "kicked" });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Bans a member from the guild. */
  async banUser(
    guildId: string,
    userId: string,
    reason?: string,
    deleteMessageDays?: number
  ): Promise<ToolResult<{ userId: string; action: "banned" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const deleteSeconds =
        deleteMessageDays != null ? deleteMessageDays * 24 * 60 * 60 : undefined;

      await guild.members.ban(userId, {
        reason: reason ?? "Banned via Poke Discord MCP",
        deleteMessageSeconds: deleteSeconds,
      });

      return successResult({ userId, action: "banned" });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Creates a new role with optional color and permissions. */
  async createRole(
    guildId: string,
    name: string,
    color?: number,
    permissions?: string
  ): Promise<ToolResult<RoleSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const role = await guild.roles.create({
        name,
        color: color ?? 0,
        permissions: new PermissionsBitField(parsePermissions(permissions)),
        reason: "Created via Poke Discord MCP",
      });

      return successResult({
        id: role.id,
        name: role.name,
        color: role.color,
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Assigns a role to a guild member. */
  async assignRole(
    guildId: string,
    userId: string,
    roleId: string
  ): Promise<ToolResult<{ userId: string; roleId: string; action: "assigned" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return errorResult("NOT_FOUND", `User ${userId} is not a member of this guild.`);
      }

      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        return errorResult("NOT_FOUND", `Role ${roleId} does not exist in this guild.`);
      }

      await member.roles.add(role, "Assigned via Poke Discord MCP");

      return successResult({ userId, roleId, action: "assigned" });
    } catch (err) {
      return mapDiscordError(err);
    }
  }
}

/** Human-readable label for discord.js channel type numbers. */
function ChannelTypeLabel(type: number): string {
  const labels: Record<number, string> = {
    0: "text",
    2: "voice",
    4: "category",
    5: "announcement",
    13: "stage",
    15: "forum",
  };
  return labels[type] ?? `type_${type}`;
}

/** Reads channel sort position when available on guild channels. */
function getChannelPosition(channel: { position?: number }): number {
  return typeof channel.position === "number" ? channel.position : 0;
}

/** Shared singleton used by MCP tools. */
export const discordManager = new DiscordManager();
