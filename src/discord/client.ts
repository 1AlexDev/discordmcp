import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { env } from "../config/env.js";
import { registerAutomationListeners } from "./automation-engine.js";

let discordClient: Client | null = null;
let readyPromise: Promise<Client> | null = null;

/** Creates and logs in the discord.js client (singleton). */
export function getDiscordClient(): Client {
  if (!discordClient) {
    discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }
  return discordClient;
}

/** Waits until the bot is ready. Resolves with the logged-in client. */
export function waitForDiscordReady(): Promise<Client> {
  const client = getDiscordClient();

  if (client.isReady()) {
    return Promise.resolve(client);
  }

  if (!readyPromise) {
    readyPromise = new Promise((resolve, reject) => {
      client.once("ready", () => {
        registerAutomationListeners(client);
        console.log(`[discord] Bot logged in as ${client.user?.tag}`);
        resolve(client);
      });
      client.once("error", reject);

      client.login(env.DISCORD_TOKEN).catch(reject);
    });
  }

  return readyPromise;
}

/** Maps our channel type strings to discord.js ChannelType enum values. */
export function toDiscordChannelType(type: "text" | "voice"): ChannelType {
  return type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
}

/** Parses a permissions bitfield string into a bigint, defaulting to none. */
export function parsePermissions(permissions?: string): bigint {
  if (!permissions) return 0n;
  try {
    return BigInt(permissions);
  } catch {
    return 0n;
  }
}

export { PermissionFlagsBits, ChannelType };
