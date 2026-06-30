import {
  type Client,
  type GuildMember,
  type Interaction,
  type Message,
  ChannelType,
  EmbedBuilder,
  type TextChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
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

/** SSE Stream for Interaction Events */
export const interactionStream = {
  listeners: new Set<(event: any) => void>(),
  push(event: any) {
    this.listeners.forEach((l) => l(event));
  },
};

function cacheKey(
  guildId: string,
  eventType: string,
  triggerId: string | null,
): string {
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

function buildEmbed(
  raw: Record<string, unknown>,
  variables: Record<string, string>,
): EmbedBuilder {
  const embed = new EmbedBuilder();

  const replaceVars = (str: string) => {
    let result = str;
    for (const [key, val] of Object.entries(variables)) {
      result = result.replaceAll(`$${key}`, val);
    }
    return result;
  };

  if (typeof raw.title === "string") embed.setTitle(replaceVars(raw.title));
  if (typeof raw.description === "string")
    embed.setDescription(replaceVars(raw.description));
  if (typeof raw.color === "number") embed.setColor(raw.color);
  if (typeof raw.footer === "string")
    embed.setFooter({ text: replaceVars(raw.footer) });
  if (Array.isArray(raw.fields)) {
    embed.addFields(
      raw.fields.filter(isRecord).map((field) => ({
        name:
          typeof field.name === "string" ? replaceVars(field.name) : "Field",
        value: typeof field.value === "string" ? replaceVars(field.value) : " ",
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
  variables: Record<string, string>,
): Promise<Record<string, string>> {
  if (!isRecord(action) || typeof action.type !== "string") return variables;

  const replaceVars = (str: string) => {
    let result = str;
    for (const [key, val] of Object.entries(variables)) {
      result = result.replaceAll(`$${key}`, val);
    }
    return result;
  };

  switch (action.type) {
    case "SEND_MESSAGE": {
      const channelId =
        typeof action.channel_id === "string"
          ? replaceVars(action.channel_id)
          : context.interaction?.channelId || context.message?.channelId;
      const content =
        typeof action.content === "string"
          ? replaceVars(action.content)
          : undefined;
      const components = Array.isArray(action.components)
        ? action.components
        : undefined;
      const ephemeral = action.ephemeral === true;

      if (!channelId || (!content && !components)) return variables;

      if (ephemeral && context.interaction?.isRepliable()) {
        await (context.interaction as any).reply({
          content,
          components: components as any,
          ephemeral: true,
        });
      } else {
        const channel = await context.client.channels
          .fetch(channelId)
          .catch(() => null);
        if (!channel || !channel.isTextBased()) return variables;
        await (channel as TextChannel).send({
          content,
          components: components as any,
        });
      }
      return variables;
    }

    case "SEND_EMBED": {
      const channelId =
        typeof action.channel_id === "string"
          ? replaceVars(action.channel_id)
          : context.interaction?.channelId || context.message?.channelId;
      const embedData = isRecord(action.embed) ? action.embed : null;
      if (!channelId || !embedData) return variables;

      const channel = await context.client.channels
        .fetch(channelId)
        .catch(() => null);
      if (!channel || !channel.isTextBased()) return variables;
      await (channel as TextChannel).send({
        embeds: [buildEmbed(embedData, variables)],
      });
      return variables;
    }

    case "ADD_ROLE": {
      const roleId =
        typeof action.role_id === "string" ? replaceVars(action.role_id) : null;
      const userId =
        typeof action.user_id === "string"
          ? replaceVars(action.user_id)
          : context.member?.id;
      if (!roleId || !userId) return variables;

      const guild = await context.client.guilds
        .fetch(context.guildId)
        .catch(() => null);
      const member = await guild?.members.fetch(userId).catch(() => null);
      if (!member) return variables;
      await member.roles.add(roleId, `Automation script ${script.id}`);
      return variables;
    }

    case "CREATE_CHANNEL": {
      const name =
        typeof action.name === "string" ? replaceVars(action.name) : null;
      if (!name) return variables;

      const guild = await context.client.guilds
        .fetch(context.guildId)
        .catch(() => null);
      if (!guild) return variables;

      const permissionOverwrites = Array.isArray(action.permission_overwrites)
        ? action.permission_overwrites
            .map((ow: any) => ({
              id: typeof ow.id === "string" ? replaceVars(ow.id) : ow.id,
              type: ow.type,
              allow: ow.allow ? BigInt(ow.allow) : undefined,
              deny: ow.deny ? BigInt(ow.deny) : undefined,
            }))
            .filter((ow) => ow.id)
        : undefined;

      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent:
          typeof action.parent_id === "string"
            ? replaceVars(action.parent_id)
            : undefined,
        permissionOverwrites: permissionOverwrites as any,
      });

      if (channel.isTextBased()) {
        const content =
          typeof action.initial_message === "string"
            ? replaceVars(action.initial_message)
            : undefined;
        const components = Array.isArray(action.components)
          ? action.components
          : undefined;
        if (content || components) {
          await channel.send({ content, components: components as any });
        }
      }

      return {
        ...variables,
        channel_id: channel.id,
        channel_name: channel.name,
      };
    }

    case "SHOW_MODAL": {
      if (
        !context.interaction?.isModalSubmit &&
        (context.interaction as any).showModal
      ) {
        const modal = new ModalBuilder()
          .setCustomId(
            typeof action.custom_id === "string"
              ? replaceVars(action.custom_id)
              : `modal-${script.id}`,
          )
          .setTitle(
            typeof action.title === "string"
              ? replaceVars(action.title)
              : "Form",
          );

        const rows: ActionRowBuilder<TextInputBuilder>[] = [];
        if (Array.isArray(action.fields)) {
          for (const field of action.fields) {
            if (!isRecord(field)) continue;
            const input = new TextInputBuilder()
              .setCustomId(
                typeof field.custom_id === "string"
                  ? replaceVars(field.custom_id)
                  : "field",
              )
              .setLabel(
                typeof field.label === "string"
                  ? replaceVars(field.label)
                  : "Input",
              )
              .setStyle(
                field.paragraph
                  ? TextInputStyle.Paragraph
                  : TextInputStyle.Short,
              )
              .setRequired(field.required !== false);

            rows.push(
              new ActionRowBuilder<TextInputBuilder>().addComponents(input),
            );
          }
        }
        modal.addComponents(...rows);
        await (context.interaction as any).showModal(modal);
      }
      return variables;
    }

    case "DELETE_CHANNEL": {
      const channelId =
        typeof action.channel_id === "string"
          ? replaceVars(action.channel_id)
          : context.interaction?.channelId;
      if (!channelId) return variables;

      const channel = await context.client.channels
        .fetch(channelId)
        .catch(() => null);
      if (!channel) return variables;
      await channel.delete(`Automation script ${script.id}`);
      return variables;
    }

    default:
      console.warn(
        `[automation] Unknown action type ${action.type} in script ${script.id}`,
      );
      return variables;
  }
}

export async function executeScripts(
  scripts: AutomationScript[],
  context: {
    client: Client;
    guildId: string;
    member?: GuildMember | null;
    message?: Message;
    interaction?: Interaction;
  },
  initialVariables: Record<string, string> = {},
): Promise<void> {
  const baseVariables = {
    ...initialVariables,
    userId: context.member?.id || context.interaction?.user.id || "",
    username:
      context.member?.user.username || context.interaction?.user.username || "",
    guildId: context.guildId,
  };

  for (const script of scripts) {
    let variables: Record<string, string> = { ...baseVariables };
    for (const action of script.actions) {
      try {
        variables = await executeAction(script, action, context, variables);
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
    if (!interaction.guildId) return;

    interactionStream.push({
      type: "interaction",
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      user: { id: interaction.user.id, username: interaction.user.username },
      interactionType: interaction.type,
      customId: (interaction as any).customId || null,
    });

    if (interaction.isButton()) {
      try {
        const scripts = await getScriptsForEvent(
          interaction.guildId,
          "BUTTON_CLICK",
          interaction.customId,
        );
        if (!scripts.length) return;

        const hasModal = scripts.some((s) =>
          s.actions.some((a: any) => a.type === "SHOW_MODAL"),
        );

        if (!hasModal && !interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate().catch(() => undefined);
        }

        await executeScripts(scripts, {
          client,
          guildId: interaction.guildId,
          member:
            interaction.member instanceof Object
              ? (interaction.member as GuildMember)
              : null,
          interaction,
        });
      } catch (err) {
        console.error("[automation] interactionCreate (button) failed:", err);
      }
    } else if (interaction.isModalSubmit()) {
      try {
        const scripts = await getScriptsForEvent(
          interaction.guildId,
          "MODAL_SUBMIT",
          interaction.customId,
        );
        if (!scripts.length) return;

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferUpdate().catch(() => undefined);
        }

        const modalVars: Record<string, string> = {};
        interaction.fields.fields.forEach((f: any) => {
          if (f.value !== undefined) {
            modalVars[f.customId] = f.value;
          }
        });

        await executeScripts(
          scripts,
          {
            client,
            guildId: interaction.guildId,
            member:
              interaction.member instanceof Object
                ? (interaction.member as GuildMember)
                : null,
            interaction,
          },
          modalVars,
        );
      } catch (err) {
        console.error("[automation] interactionCreate (modal) failed:", err);
      }
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
