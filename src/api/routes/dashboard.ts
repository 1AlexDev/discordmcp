import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  createAutomationScript,
  deleteAutomationScript,
  getAccountLinksByPokeUserId,
  getAutomationScriptById,
  getAutomationScriptsByGuild,
  isGuildLinkedToPokeUser,
  updateAutomationScript,
} from "../../db/supabase.js";
import { getDiscordClient, waitForDiscordReady } from "../../discord/client.js";
import { invalidateAutomationCache } from "../../discord/automation-engine.js";
import {
  clearPokeUserCookie,
  getPokeUserIdFromRequest,
  setPokeUserCookie,
} from "../session.js";

const automationScriptPayloadSchema = z.object({
  event_type: z.string().min(1).max(100),
  trigger_id: z.string().max(200).nullable().optional(),
  actions: z.array(z.record(z.string(), z.unknown())).default([]),
  active: z.boolean().optional(),
});

interface DashboardServerSummary {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number | null;
  channelCount: number | null;
  status: "active" | "unavailable";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchLinkedServers(
  pokeUserId: string,
): Promise<DashboardServerSummary[]> {
  const links = await getAccountLinksByPokeUserId(pokeUserId);
  await waitForDiscordReady();
  const client = getDiscordClient();

  return Promise.all(
    links.map(async (link) => {
      const guild =
        client.guilds.cache.get(link.discord_guild_id) ??
        (await client.guilds.fetch(link.discord_guild_id).catch(() => null));

      if (!guild) {
        return {
          id: link.discord_guild_id,
          name: `Unavailable server ${link.discord_guild_id}`,
          icon: null,
          memberCount: null,
          channelCount: null,
          status: "unavailable",
        } satisfies DashboardServerSummary;
      }

      const channels = await guild.channels.fetch().catch(() => null);

      return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        memberCount: guild.memberCount,
        channelCount: channels?.size ?? null,
        status: "active",
      } satisfies DashboardServerSummary;
    }),
  );
}

function renderDashboardPage(pokeUserId: string): string {
  const safePokeUserId = escapeHtml(pokeUserId);
  const oauthUrl = `/auth/init?poke_user_id=${encodeURIComponent(pokeUserId)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — Poke Discord MCP</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: antialiased;
    }
    .page-enter { animation: page-enter 420ms cubic-bezier(0.16, 1, 0.3, 1) both; }
    .card-enter { animation: card-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) both; }
    @keyframes page-enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes card-enter {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
    }
  </style>
</head>
<body class="min-h-screen bg-neutral-50 text-neutral-950 selection:bg-neutral-950 selection:text-white">
  <main class="page-enter mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
    <header class="flex flex-col gap-6 border-b border-neutral-200 pb-8 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">Poke Discord MCP</p>
        <h1 class="mt-3 text-3xl font-semibold tracking-[-0.04em] text-neutral-950 sm:text-4xl">Server dashboard</h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">
          Manage every Discord server connected to your Poke account from one clean workspace.
        </p>
      </div>
      <div class="flex flex-col items-start gap-3 sm:items-end">
        <div class="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700">
          ${safePokeUserId}
        </div>
        <form action="/dashboard/logout" method="POST">
          <button class="text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-950" type="submit">
            Logout
          </button>
        </form>
      </div>
    </header>

    <section class="py-10">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-xl font-semibold tracking-[-0.03em]">Active servers</h2>
          <p class="mt-2 text-sm text-neutral-600">Connected servers update from the live Discord bot client.</p>
        </div>
        <a href="${oauthUrl}" class="inline-flex items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0">
          Add to new server
        </a>
      </div>

      <div id="server-grid" class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="rounded-2xl border border-neutral-200 bg-white p-5">
          <div class="h-12 w-12 animate-pulse rounded-2xl bg-neutral-100"></div>
          <div class="mt-5 h-4 w-40 animate-pulse rounded bg-neutral-100"></div>
          <div class="mt-3 h-3 w-28 animate-pulse rounded bg-neutral-100"></div>
        </div>
      </div>
    </section>

    <section id="scripts-section" class="hidden border-t border-neutral-200 py-10">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Scripts & Automations</p>
          <h2 id="scripts-title" class="mt-2 text-xl font-semibold tracking-[-0.03em]">Select a server</h2>
          <p class="mt-2 text-sm text-neutral-600">Review active triggers and remove automation scripts instantly.</p>
        </div>
        <div class="flex items-center gap-3">
          <a id="open-studio" href="#" class="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">Open Studio</a>
          <button id="close-scripts" class="text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-950" type="button">Close</button>
        </div>
      </div>
      <div id="scripts-list" class="mt-6 space-y-3"></div>
    </section>
  </main>

  <div id="toast" class="fixed bottom-6 left-1/2 hidden -translate-x-1/2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800"></div>

  <script>
    const grid = document.getElementById('server-grid');
    const scriptsSection = document.getElementById('scripts-section');
    const scriptsTitle = document.getElementById('scripts-title');
    const scriptsList = document.getElementById('scripts-list');
    const closeScripts = document.getElementById('close-scripts');
    const openStudio = document.getElementById('open-studio');
    const toast = document.getElementById('toast');
    let selectedGuildId = null;

    function formatNumber(value) {
      if (value === null || value === undefined) return '—';
      return new Intl.NumberFormat().format(value);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function initials(name) {
      return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DS';
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.remove('hidden');
      window.setTimeout(() => toast.classList.add('hidden'), 2200);
    }

    function summarizeActions(actions) {
      if (!Array.isArray(actions) || !actions.length) return 'No actions';
      return actions.map((action) => {
        if (!action || typeof action !== 'object') return 'Unknown';
        return String(action.type || 'Unknown').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      }).join(' + ');
    }

    function triggerLabel(script) {
      const event = String(script.event_type || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      return event + (script.trigger_id ? ': ' + script.trigger_id : '');
    }

    function renderScript(script) {
      return '<article id="script-' + escapeHtml(script.id) + '" class="rounded-2xl border border-neutral-200 bg-white p-4">'
        + '<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">'
        + '<div class="min-w-0">'
        + '<p class="truncate text-sm font-semibold text-neutral-950">' + escapeHtml(triggerLabel(script)) + '</p>'
        + '<p class="mt-1 truncate text-sm text-neutral-600">' + escapeHtml(summarizeActions(script.actions)) + '</p>'
        + '<p class="mt-2 text-xs text-neutral-400">Script ID ' + escapeHtml(script.id) + '</p>'
        + '</div>'
        + '<div class="flex shrink-0 items-center gap-2">'
        + '<a href="/dashboard/studio/' + encodeURIComponent(selectedGuildId || script.discord_guild_id || '') + '/' + encodeURIComponent(script.id) + '" class="rounded-xl bg-neutral-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-800">Edit</a>'
        + '<button type="button" data-script-id="' + escapeHtml(script.id) + '" class="delete-script rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:border-red-300 hover:text-red-700">Delete</button>'
        + '</div>'
        + '</div>'
        + '</article>';
    }

    async function loadScripts(guildId, guildName) {
      selectedGuildId = guildId;
      scriptsSection.classList.remove('hidden');
      scriptsTitle.textContent = 'Scripts for ' + guildName;
      openStudio.href = '/dashboard/studio/' + encodeURIComponent(guildId);
      scriptsList.innerHTML = '<div class="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-500">Loading scripts…</div>';
      scriptsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      try {
        const response = await fetch('/api/servers/' + encodeURIComponent(guildId) + '/scripts', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Failed to load scripts');
        const payload = await response.json();

        if (!payload.scripts.length) {
          scriptsList.innerHTML = '<div class="rounded-2xl border border-neutral-200 bg-white p-8 text-center">'
            + '<h3 class="text-base font-semibold text-neutral-950">No scripts yet</h3>'
            + '<p class="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-600">Create one in the visual studio or use Poke to generate it for you.</p>'
            + '<a href="/dashboard/studio/' + encodeURIComponent(guildId) + '" class="mt-5 inline-flex items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Open Studio</a>'
            + '</div>';
          return;
        }

        scriptsList.innerHTML = payload.scripts.map(renderScript).join('');
      } catch (error) {
        scriptsList.innerHTML = '<div class="rounded-2xl border border-red-200 bg-white p-8 text-center">'
          + '<h3 class="text-base font-semibold text-neutral-950">Could not load scripts</h3>'
          + '<p class="mt-2 text-sm text-neutral-600">Refresh the page and try again.</p>'
          + '</div>';
      }
    }

    async function deleteScript(scriptId) {
      const node = document.getElementById('script-' + scriptId);
      if (node) node.classList.add('opacity-50');

      try {
        const response = await fetch('/api/scripts/' + encodeURIComponent(scriptId), {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        if (!response.ok) throw new Error('Failed to delete script');

        if (node) node.remove();
        showToast('Script deleted');
        if (!scriptsList.children.length && selectedGuildId) {
          scriptsList.innerHTML = '<div class="rounded-2xl border border-neutral-200 bg-white p-8 text-center"><h3 class="text-base font-semibold text-neutral-950">No scripts yet</h3></div>';
        }
      } catch (error) {
        if (node) node.classList.remove('opacity-50');
        showToast('Could not delete script');
      }
    }

    function renderServer(server, index) {
      const safeName = escapeHtml(server.name);
      const safeId = escapeHtml(server.id);
      const safeIcon = server.icon ? escapeHtml(server.icon) : null;
      const statusClass = server.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-neutral-100 text-neutral-600 border-neutral-200';
      const statusText = server.status === 'active' ? 'Active / Connected' : 'Unavailable';
      const icon = safeIcon
        ? '<img src="' + safeIcon + '" alt="" class="h-12 w-12 rounded-2xl object-cover">'
        : '<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-sm font-semibold text-white">' + escapeHtml(initials(server.name)) + '</div>';

      return '<article class="card-enter rounded-2xl border border-neutral-200 bg-white p-5 transition-transform hover:-translate-y-0.5" style="animation-delay: ' + (index * 35) + 'ms">'
        + '<div class="flex items-start justify-between gap-4">'
        + icon
        + '<span class="rounded-full border px-2.5 py-1 text-[11px] font-semibold ' + statusClass + '">' + statusText + '</span>'
        + '</div>'
        + '<h3 class="mt-5 truncate text-base font-semibold text-neutral-950">' + safeName + '</h3>'
        + '<p class="mt-1 truncate text-xs text-neutral-500">Guild ID ' + safeId + '</p>'
        + '<div class="mt-5 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-5">'
        + '<div><p class="text-xs text-neutral-500">Members</p><p class="mt-1 text-sm font-semibold text-neutral-950">' + formatNumber(server.memberCount) + '</p></div>'
        + '<div><p class="text-xs text-neutral-500">Channels</p><p class="mt-1 text-sm font-semibold text-neutral-950">' + formatNumber(server.channelCount) + '</p></div>'
        + '</div>'
        + '<button type="button" data-guild-id="' + safeId + '" data-guild-name="' + safeName + '" class="manage-scripts mt-5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-neutral-950">Manage scripts</button>'
        + '</article>';
    }

    async function loadServers() {
      try {
        const response = await fetch('/api/user/servers', { credentials: 'same-origin' });
        if (response.status === 401) {
          window.location.href = '/auth';
          return;
        }
        if (!response.ok) throw new Error('Failed to load servers');

        const payload = await response.json();
        if (!payload.servers.length) {
          grid.innerHTML = '<div class="col-span-full rounded-2xl border border-neutral-200 bg-white p-8 text-center">'
            + '<h3 class="text-base font-semibold text-neutral-950">No servers linked yet</h3>'
            + '<p class="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-600">Add the Discord bot to your first server to start managing it with Poke.</p>'
            + '<a href="${oauthUrl}" class="mt-5 inline-flex items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Add to new server</a>'
            + '</div>';
          return;
        }

        grid.innerHTML = payload.servers.map(renderServer).join('');
        grid.querySelectorAll('.manage-scripts').forEach((button) => {
          button.addEventListener('click', () => {
            loadScripts(button.dataset.guildId, button.dataset.guildName);
          });
        });
      } catch (error) {
        grid.innerHTML = '<div class="col-span-full rounded-2xl border border-red-200 bg-white p-8 text-center">'
          + '<h3 class="text-base font-semibold text-neutral-950">Could not load servers</h3>'
          + '<p class="mt-2 text-sm text-neutral-600">Refresh the page or retry after the bot is online.</p>'
          + '</div>';
      }
    }

    scriptsList.addEventListener('click', (event) => {
      const button = event.target.closest('.delete-script');
      if (!button) return;
      deleteScript(button.dataset.scriptId);
    });

    closeScripts.addEventListener('click', () => {
      selectedGuildId = null;
      scriptsSection.classList.add('hidden');
      scriptsList.innerHTML = '';
    });

    loadServers();
  </script>
</body>
</html>`;
}

export const dashboardRouter = Router();
export const userApiRouter = Router();

dashboardRouter.get("/", (req: Request, res: Response) => {
  const pokeUserId = getPokeUserIdFromRequest(req);
  if (!pokeUserId) {
    res.redirect("/auth");
    return;
  }

  setPokeUserCookie(res, pokeUserId);
  res.type("html").send(renderDashboardPage(pokeUserId));
});

dashboardRouter.post("/logout", (_req: Request, res: Response) => {
  clearPokeUserCookie(res);
  res.redirect("/auth");
});

userApiRouter.get("/user/servers", async (req: Request, res: Response) => {
  const pokeUserId = getPokeUserIdFromRequest(req);
  if (!pokeUserId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const servers = await fetchLinkedServers(pokeUserId);
    res.json({ pokeUserId, servers });
  } catch (err) {
    console.error("[dashboard] Failed to fetch linked servers:", err);
    res.status(500).json({
      error: "Failed to load linked servers",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

userApiRouter.get(
  "/servers/:guild_id/scripts",
  async (req: Request, res: Response) => {
    const pokeUserId = getPokeUserIdFromRequest(req);
    if (!pokeUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const guildId = String(req.params.guild_id);

    try {
      const linked = await isGuildLinkedToPokeUser(pokeUserId, guildId);
      if (!linked) {
        res
          .status(403)
          .json({ error: "Server is not linked to this Poke user" });
        return;
      }

      const scripts = await getAutomationScriptsByGuild(pokeUserId, guildId);
      res.json({ guildId, scripts });
    } catch (err) {
      console.error("[dashboard] Failed to fetch scripts:", err);
      res.status(500).json({
        error: "Failed to load scripts",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

userApiRouter.post(
  "/servers/:guild_id/scripts",
  async (req: Request, res: Response) => {
    const pokeUserId = getPokeUserIdFromRequest(req);
    if (!pokeUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const guildId = String(req.params.guild_id);

    try {
      const linked = await isGuildLinkedToPokeUser(pokeUserId, guildId);
      if (!linked) {
        res
          .status(403)
          .json({ error: "Server is not linked to this Poke user" });
        return;
      }

      const body = automationScriptPayloadSchema.parse(req.body);
      const script = await createAutomationScript({
        pokeUserId,
        discordGuildId: guildId,
        eventType: body.event_type,
        triggerId: body.trigger_id ?? null,
        actions: body.actions,
      });

      invalidateAutomationCache();
      res.status(201).json({ script });
    } catch (err) {
      console.error("[dashboard] Failed to create script:", err);
      res.status(400).json({
        error: "Failed to create script",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

userApiRouter.put(
  "/scripts/:script_id",
  async (req: Request, res: Response) => {
    const pokeUserId = getPokeUserIdFromRequest(req);
    if (!pokeUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const scriptId = String(req.params.script_id);

    try {
      const existing = await getAutomationScriptById(scriptId);
      if (!existing || existing.poke_user_id !== pokeUserId) {
        res.status(404).json({ error: "Script not found" });
        return;
      }

      const body = automationScriptPayloadSchema.parse(req.body);
      const script = await updateAutomationScript(scriptId, {
        pokeUserId,
        discordGuildId: existing.discord_guild_id,
        eventType: body.event_type,
        triggerId: body.trigger_id ?? null,
        actions: body.actions,
        active: body.active,
      });

      invalidateAutomationCache();
      res.json({ script });
    } catch (err) {
      console.error("[dashboard] Failed to update script:", err);
      res.status(400).json({
        error: "Failed to update script",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

userApiRouter.delete(
  "/scripts/:script_id",
  async (req: Request, res: Response) => {
    const pokeUserId = getPokeUserIdFromRequest(req);
    if (!pokeUserId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const scriptId = String(req.params.script_id);

    try {
      const script = await getAutomationScriptById(scriptId);
      if (!script || script.poke_user_id !== pokeUserId) {
        res.status(404).json({ error: "Script not found" });
        return;
      }

      await deleteAutomationScript(scriptId, pokeUserId);
      invalidateAutomationCache();
      res.json({ id: scriptId, deleted: true });
    } catch (err) {
      console.error("[dashboard] Failed to delete script:", err);
      res.status(500).json({
        error: "Failed to delete script",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
