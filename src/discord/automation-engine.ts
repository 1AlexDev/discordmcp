import {
  type Client,
  type GuildMember,
  type Interaction,
  type Message,
  ChannelType,
  EmbedBuilder,
  type TextChannel,
} from "discord.js";
import {
  getActiveAutomationScriptsForTrigger,
  type AutomationScript,
} from "../db/supabase.js";

const SCRIPT_CACHE_TTL_MS = 10_000;
let listenersRegistered = false;

const scriptCache = new Map<
  string,
  { expiresAt: number; scripts: AutomationScript[] }
>();

function cacheKey(guildId: string, eventType: string, triggerId: string | null): string {
  return `${guildId}:${eventType}:${triggerId ?? ""}`;
}

export function invalidateAutomationCache(): void {
  scriptCache.clear();
}

async function getScriptsForEvent(
  guildId: string,
  eventType: string,
  triggerId: string | null,
): Promise<AutomationScript[]> {
  const key = cacheKey(guildId, eventType, triggerId);
  const cached = scriptCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.scripts;
  }

  const scripts = await getActiveAutomationScriptsForTrigger(
    guildId,
    eventType,
    triggerId,
  );

  scriptCache.set(key, {
    expiresAt: Date.now() + SCRIPT_CACHE_TTL_MS,
    scripts,
  });

  return scripts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildEmbed(raw: Record<string, unknown>): EmbedBuilder {
  const embed = new EmbedBuilder();
  if (typeof raw.title === "string") embed.setTitle(raw.title);
  if (typeof raw.description === "string") embed.setDescription(raw.description);
  if (typeof raw.color === "number") embed.setColor(raw.color);
  if (typeof raw.footer === "string") embed.setFooter({ text: raw.footer });
  if (Array.isArray(raw.fields)) {
    embed.addFields(
      raw.fields
        .filter(isRecord)
        .map((field) => ({
          name: typeof field.name === "string" ? field.name : "Field",
          value: typeof field.value === "string" ? field.value : " ",
          inline: typeof field.inline === "boolean" ? field.inline : undefined,
        })),
    );
  }
  return embed;
}

async function executeAction(
  script: AutomationScript,
  action: unknown,
  context: {
    client: Client;
    guildId: string;
    member?: GuildMember | null;
    message?: Message;
    interaction?: Interaction;
  },
): Promise<void> {
  if (!isRecord(action) || typeof action.type !== "string") return;

  switch (action.type) {
    case "SEND_MESSAGE": {
      const channelId = typeof action.channel_id === "string" ? action.channel_id : (context.interaction?.channelId || context.message?.channelId);
      const content = typeof action.content === "string" ? action.content : undefined;
      const components = Array.isArray(action.components) ? action.components : undefined;
      if (!channelId || (!content && !components)) return;

      const channel = await context.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;
      await (channel as TextChannel).send({ content, components: components as any });
      return;
    }

    case "SEND_EMBED": {
      const channelId = typeof action.channel_id === "string" ? action.channel_id : (context.interaction?.channelId || context.message?.channelId);
      const embedData = isRecord(action.embed) ? action.embed : null;
      if (!channelId || !embedData) return;

      const channel = await context.client.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return;
      await (channel as TextChannel).send({ embeds: [buildEmbed(embedData)] });
      return;
    }

    case "ADD_ROLE": {
      const roleId = typeof action.role_id === "string" ? action.role_id : null;
      const userId = typeof action.user_id === "string" ? action.user_id : context.member?.id;
      if (!roleId || !userId) return;

      const guild = await context.client.guilds.fetch(context.guildId).catch(() => null);
      const member = await guild?.members.fetch(userId).catch(() => null);
      if (!member) return;
      await member.roles.add(roleId, `Automation script ${script.id}`);
      return;
    }

    case "REMOVE_ROLE": {
      const roleId = typeof action.role_id === "string" ? action.role_id : null;
      const userId = typeof action.user_id === "string" ? action.user_id : context.member?.id;
      if (!roleId || !userId) return;

      const guild = await context.client.guilds.fetch(context.guildId).catch(() => null);
      const member = await guild?.members.fetch(userId).catch(() => null);
      if (!member) return;
      await member.roles.remove(roleId, `Automation script ${script.id}`);
      return;
    }

    case "CREATE_CHANNEL": {
      const name = typeof action.name === "string" ? action.name : null;
      if (!name) return;

      const guild = await context.client.guilds.fetch(context.guildId).catch(() => null);
      if (!guild) return;

      const permissionOverwrites = Array.isArray(action.permission_overwrites)
        ? action.permission_overwrites.map((ow: any) => ({
            id: ow.id === "$userId" ? context.member?.id : ow.id,
            type: ow.type,
            allow: ow.allow ? BigInt(ow.allow) : undefined,
            deny: ow.deny ? BigInt(ow.deny) : undefined,
          })).filter(ow => ow.id)
        : undefined;

      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: typeof action.parent_id === "string" ? action.parent_id : undefined,
        permissionOverwrites: permissionOverwrites as any,
      });

      if (channel.isTextBased()) {
        const content = typeof action.initial_message === "string" ? action.initial_message : undefined;
        const components = Array.isArray(action.components) ? action.components : undefined;
        if (content || components) {
          await channel.send({ content, components: components as any });
        }
      }
      return;
    }

    case "DELETE_CHANNEL": {
      const channelId = typeof action.channel_id === "string" ? action.channel_id : context.interaction?.channelId;
      if (!channelId) return;

      const channel = await context.client.channels.fetch(channelId).catch(() => null);
      if (!channel) return;
      await channel.delete(`Automation script ${script.id}`);
      return;
    }

    default:
      console.warn(`[automation] Unknown action type ${action.type} in script ${script.id}`);
  }
}

async function executeScripts(
  scripts: AutomationScript[],
  context: {
    client: Client;
    guildId: string;
    member?: GuildMember | null;
    message?: Message;
    interaction?: Interaction;
  },
): Promise<void> {
  for (const script of scripts) {
    for (const action of script.actions) {
      try {
        await executeAction(script, action, context);
      } catch (err) {
        console.error(
          `[automation] Failed action in script ${script.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

export function registerAutomationListeners(client: Client): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guildId || !interaction.isButton()) return;

    try {
      const scripts = await getScriptsForEvent(
        interaction.guildId,
        "BUTTON_CLICK",
        interaction.customId,
      );
      if (!scripts.length) return;

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => undefined);
      }

      await executeScripts(scripts, {
        client,
        guildId: interaction.guildId,
        member: interaction.member instanceof Object ? (interaction.member as GuildMember) : null,
        interaction,
      });
    } catch (err) {
      console.error("[automation] interactionCreate failed:", err);
    }
  });

  client.on("messageCreate", async (message) => {
    if (!message.guildId || message.author.bot) return;

    try {
      const scripts = await getScriptsForEvent(
        message.guildId,
        "MESSAGE_CREATE",
        message.channelId,
      );
      if (!scripts.length) return;

      await executeScripts(scripts, {
        client,
        guildId: message.guildId,
        member: message.member,
        message,
      });
    } catch (err) {
      console.error("[automation] messageCreate failed:", err);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      const scripts = await getScriptsForEvent(
        member.guild.id,
        "GUILD_MEMBER_ADD",
        "*",
      );
      if (!scripts.length) return;

      await executeScripts(scripts, {
        client,
        guildId: member.guild.id,
        member,
      });
    } catch (err) {
      console.error("[automation] guildMemberAdd failed:", err);
    }
  });

  console.log("[automation] Discord automation listeners registered");
}
