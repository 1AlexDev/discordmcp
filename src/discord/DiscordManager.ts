import {
  type Guild,
  ChannelType,
  PermissionsBitField,
  type TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle,
  StringSelectMenuOptionBuilder,
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
  author: string;
  authorId: string;
  timestamp: string;
}

export interface MemberSummary {
  id: string;
  username: string;
  displayName: string;
  bot: boolean;
  joinedAt: string | null;
  roles: string[];
}

export interface ServerInfo {
  id: string;
  name: string;
  memberCount: number;
  channelCount: number;
  ownerId: string;
  icon: string | null;
}

/**
 * Central service for all Discord bot actions.
 * Every method operates within a specific guild ID resolved from Supabase.
 */
export class DiscordManager {
  /** Fetches a guild and verifies the bot is a member. */
  private async getGuild(
    guildId: string,
  ): Promise<Guild | Extract<ToolResult, { success: false }>> {
    await waitForDiscordReady();
    const client = getDiscordClient();
    const guild =
      client.guilds.cache.get(guildId) ??
      (await client.guilds.fetch(guildId).catch(() => null));

    if (!guild) {
      return errorResult(
        "BOT_NOT_IN_GUILD",
        `Bot is not present in guild ${guildId}. The user may need to re-invite the bot.`,
      );
    }

    return guild;
  }

  private isErrorResult(
    value: Guild | Extract<ToolResult, { success: false }>,
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
    content: string,
  ): Promise<ToolResult<MessageSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return errorResult(
          "NOT_FOUND",
          `Channel ${channelId} is not a text channel in this guild.`,
        );
      }

      const textChannel = channel as TextChannel;
      const message = await textChannel.send({ content });

      return successResult({
        id: message.id,
        channelId: message.channelId,
        content: message.content,
        author: message.author.username,
        authorId: message.author.id,
        timestamp: message.createdAt.toISOString(),
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
    parentId?: string,
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

  /** Fetches all categories in the guild. */
  async getCategories(guildId: string): Promise<ToolResult<ChannelSummary[]>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channels = await guild.channels.fetch();

      const categories = channels.filter(
        (c) => c && c.type === ChannelType.GuildCategory,
      );

      const summaries: ChannelSummary[] = [];
      for (const channel of categories.values()) {
        if (!channel) continue;

        summaries.push({
          id: channel.id,
          name: channel.name,
          type: ChannelTypeLabel(channel.type),
          parentId: null,
          position: getChannelPosition(channel),
        });
      }

      summaries.sort((a, b) => a.position - b.position);
      return successResult(summaries);
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Deletes a category. Optionally orphaned channels can be deleted but discord orphans them by default. */
  async deleteCategory(
    guildId: string,
    categoryId: string,
  ): Promise<ToolResult<{ id: string; action: "deleted" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(categoryId);

      if (!channel || channel.type !== ChannelType.GuildCategory) {
        return errorResult(
          "NOT_FOUND",
          `Category ${categoryId} not found or is not a category.`,
        );
      }

      await channel.delete("Deleted via Poke Discord MCP");
      return successResult({ id: categoryId, action: "deleted" });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Gets details for a specific channel. */
  async getChannel(
    guildId: string,
    channelId: string,
  ): Promise<ToolResult<ChannelSummary & { topic: string | null }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel) {
        return errorResult("NOT_FOUND", `Channel ${channelId} not found.`);
      }

      return successResult({
        id: channel.id,
        name: channel.name,
        type: ChannelTypeLabel(channel.type),
        parentId: channel.parentId,
        position: getChannelPosition(channel as any),
        topic:
          channel.isTextBased() && "topic" in channel
            ? (channel as TextChannel).topic
            : null,
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Deletes a channel. */
  async deleteChannel(
    guildId: string,
    channelId: string,
  ): Promise<ToolResult<{ id: string; action: "deleted" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel) {
        return errorResult("NOT_FOUND", `Channel ${channelId} not found.`);
      }

      await channel.delete("Deleted via Poke Discord MCP");
      return successResult({ id: channelId, action: "deleted" });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Updates an existing channel. */
  async updateChannel(
    guildId: string,
    channelId: string,
    options: { name?: string; topic?: string; parentId?: string },
  ): Promise<ToolResult<ChannelSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel) {
        return errorResult("NOT_FOUND", `Channel ${channelId} not found.`);
      }

      const updateData: any = {};
      if (options.name !== undefined) updateData.name = options.name;
      if (options.topic !== undefined && channel.isTextBased())
        updateData.topic = options.topic;
      if (options.parentId !== undefined) updateData.parent = options.parentId;

      const updated = await channel.edit(updateData);

      return successResult({
        id: updated.id,
        name: updated.name,
        type: ChannelTypeLabel(updated.type),
        parentId: updated.parentId,
        position: getChannelPosition(updated as any),
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Sends an embed message to a text channel. */
  async sendEmbedMessage(
    guildId: string,
    channelId: string,
    embedData: {
      title?: string;
      description?: string;
      color?: number;
      fields?: Array<{ name: string; value: string; inline?: boolean }>;
      footer?: string;
    },
  ): Promise<ToolResult<MessageSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return errorResult(
          "NOT_FOUND",
          `Channel ${channelId} is not a text channel in this guild.`,
        );
      }

      const embed = new EmbedBuilder();
      if (embedData.title) embed.setTitle(embedData.title);
      if (embedData.description) embed.setDescription(embedData.description);
      if (embedData.color !== undefined) embed.setColor(embedData.color);
      if (embedData.fields) embed.addFields(embedData.fields);
      if (embedData.footer) embed.setFooter({ text: embedData.footer });

      const textChannel = channel as TextChannel;
      const message = await textChannel.send({ embeds: [embed] });

      return successResult({
        id: message.id,
        channelId: message.channelId,
        content: message.content,
        author: message.author.username,
        authorId: message.author.id,
        timestamp: message.createdAt.toISOString(),
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Sends a message with interactive components. */
  async sendComponentMessage(
    guildId: string,
    channelId: string,
    content: string,
    componentsData: Array<{
      type: "button" | "select";
      customId: string;
      label?: string;
      style?: number; // 1: Primary, 2: Secondary, 3: Success, 4: Danger, 5: Link
      options?: Array<{ label: string; value: string; description?: string }>;
      placeholder?: string;
    }>,
  ): Promise<ToolResult<MessageSummary>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return errorResult(
          "NOT_FOUND",
          `Channel ${channelId} is not a text channel in this guild.`,
        );
      }

      const rows: ActionRowBuilder<any>[] = [];

      for (const comp of componentsData) {
        if (comp.type === "button") {
          const btn = new ButtonBuilder()
            .setCustomId(comp.customId)
            .setLabel(comp.label ?? "Button")
            .setStyle(comp.style ?? ButtonStyle.Primary);

          rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(btn));
        } else if (comp.type === "select") {
          const select = new StringSelectMenuBuilder()
            .setCustomId(comp.customId)
            .setPlaceholder(comp.placeholder ?? "Make a selection...");

          if (comp.options && comp.options.length > 0) {
            select.addOptions(
              comp.options.map((opt) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(opt.label)
                  .setValue(opt.value)
                  .setDescription(opt.description ?? ""),
              ),
            );
          } else {
            // Discord requires at least one option
            select.addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel("Default Option")
                .setValue("default"),
            );
          }

          rows.push(
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              select,
            ),
          );
        }
      }

      const textChannel = channel as TextChannel;
      const message = await textChannel.send({ content, components: rows });

      return successResult({
        id: message.id,
        channelId: message.channelId,
        content: message.content,
        author: message.author.username,
        authorId: message.author.id,
        timestamp: message.createdAt.toISOString(),
      });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Kicks a member from the guild. */
  async kickUser(
    guildId: string,
    userId: string,
    reason?: string,
  ): Promise<ToolResult<{ userId: string; action: "kicked" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return errorResult(
          "NOT_FOUND",
          `User ${userId} is not a member of this guild.`,
        );
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
    deleteMessageDays?: number,
  ): Promise<ToolResult<{ userId: string; action: "banned" }>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const deleteSeconds =
        deleteMessageDays != null
          ? deleteMessageDays * 24 * 60 * 60
          : undefined;

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
    permissions?: string,
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
    roleId: string,
  ): Promise<
    ToolResult<{ userId: string; roleId: string; action: "assigned" }>
  > {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        return errorResult(
          "NOT_FOUND",
          `User ${userId} is not a member of this guild.`,
        );
      }

      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        return errorResult(
          "NOT_FOUND",
          `Role ${roleId} does not exist in this guild.`,
        );
      }

      await member.roles.add(role, "Assigned via Poke Discord MCP");

      return successResult({ userId, roleId, action: "assigned" });
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Fetches members of the guild, optionally filtering by display name. */
  async getUsers(
    guildId: string,
    query?: string,
    limit: number = 25,
  ): Promise<ToolResult<MemberSummary[]>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const clampedLimit = Math.min(Math.max(limit, 1), 100);

      const members = query
        ? await guild.members.search({ query, limit: clampedLimit })
        : await guild.members.list({ limit: clampedLimit });

      const summaries: MemberSummary[] = members.map((m) => ({
        id: m.id,
        username: m.user.username,
        displayName: m.displayName,
        bot: m.user.bot,
        joinedAt: m.joinedAt?.toISOString() ?? null,
        roles: m.roles.cache
          .filter((r) => r.id !== guild.id)
          .map((r) => r.name),
      }));

      return successResult(summaries);
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Fetches all roles in the guild. */
  async getRoles(guildId: string): Promise<ToolResult<RoleSummary[]>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const roles = await guild.roles.fetch();

      const summaries: RoleSummary[] = roles
        .filter((r) => r.id !== guild.id) // exclude @everyone
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color }));

      return successResult(summaries);
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Reads recent messages from a text channel. */
  async readMessages(
    guildId: string,
    channelId: string,
    limit: number = 20,
  ): Promise<ToolResult<MessageSummary[]>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return errorResult(
          "NOT_FOUND",
          `Channel ${channelId} is not a text channel in this guild.`,
        );
      }

      const textChannel = channel as TextChannel;
      const clampedLimit = Math.min(Math.max(limit, 1), 50);
      const messages = await textChannel.messages.fetch({
        limit: clampedLimit,
      });

      const summaries: MessageSummary[] = messages.map((m) => ({
        id: m.id,
        channelId: m.channelId,
        content: m.content,
        author: m.author.username,
        authorId: m.author.id,
        timestamp: m.createdAt.toISOString(),
      }));

      // Return in chronological order (oldest first)
      summaries.reverse();
      return successResult(summaries);
    } catch (err) {
      return mapDiscordError(err);
    }
  }

  /** Returns high-level server information. */
  async getServerInfo(guildId: string): Promise<ToolResult<ServerInfo>> {
    try {
      const guildOrError = await this.getGuild(guildId);
      if (this.isErrorResult(guildOrError)) return guildOrError;

      const guild = guildOrError;
      const channels = await guild.channels.fetch();

      return successResult({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        channelCount: channels.size,
        ownerId: guild.ownerId,
        icon: guild.iconURL({ size: 256 }),
      });
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
