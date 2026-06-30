import { Router, type Request, type Response } from "express";
import { getActiveAutomationScriptsForTrigger } from "../../db/supabase.js";
import { getDiscordClient, waitForDiscordReady } from "../../discord/client.js";
import { executeScripts } from "../../discord/automation-engine.js";

export const webhookRouter = Router();

const webhookHandler = async (req: Request, res: Response) => {
  const guildId = String(req.params.guild_id);
  const provider = req.params.provider
    ? String(req.params.provider)
    : "generic";
  const payload = req.body;

  try {
    await waitForDiscordReady();
    const client = getDiscordClient();

    // We fetch scripts for the WEBHOOK event
    // The triggerId is the provider (e.g. github, stripe)
    const webhookScripts = await getActiveAutomationScriptsForTrigger(
      guildId,
      "WEBHOOK",
      provider,
    );

    if (webhookScripts.length > 0) {
      // Flatten payload for variable passing
      const variables: Record<string, string> = {};
      const flatten = (obj: any, prefix = "") => {
        for (const key in obj) {
          const name = prefix ? `${prefix}_${key}` : key;
          if (typeof obj[key] === "object" && obj[key] !== null) {
            flatten(obj[key], name);
          } else {
            variables[name] = String(obj[key]);
          }
        }
      };
      flatten(payload);

      await executeScripts(
        webhookScripts,
        {
          client,
          guildId,
        },
        variables,
      );
    }

    res.json({ success: true, scripts_triggered: webhookScripts.length });
  } catch (err) {
    console.error("[webhook] Failed to process webhook:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

webhookRouter.post("/:guild_id", webhookHandler);
webhookRouter.post("/:guild_id/:provider", webhookHandler);
