import { Router, type Request, type Response } from "express";
import { getPokeUserIdFromRequest } from "../session.js";
import {
  getAutomationScriptById,
  isGuildLinkedToPokeUser,
} from "../../db/supabase.js";

export const studioRouter = Router();

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderStudioPage(
  pokeUserId: string,
  guildId: string,
  script: unknown | null,
): string {
  const safePokeUserId = escapeHtml(pokeUserId);
  const safeGuildId = escapeHtml(guildId);
  const initialScript = safeJson(script);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Automation Studio — Poke Discord MCP</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-rendering: geometricPrecision; -webkit-font-smoothing: antialiased; }
    .studio-enter { animation: studio-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) both; }
    .node-enter { animation: node-enter 280ms cubic-bezier(0.16, 1, 0.3, 1) both; }
    .node-line { width: 1px; height: 28px; background: #404040; }
    @keyframes studio-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes node-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }
  </style>
</head>
<body class="h-screen overflow-hidden bg-neutral-950 text-white selection:bg-white selection:text-neutral-950">
  <div class="flex h-full">
    <main class="studio-enter flex min-w-0 flex-1 flex-col">
      <header class="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div class="flex min-w-0 items-center gap-4">
          <a href="/dashboard" class="rounded-xl border border-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white">Back</a>
          <div class="min-w-0">
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">Automation Studio</p>
            <h1 id="studio-title" class="truncate text-lg font-semibold tracking-[-0.03em] text-white">New script</h1>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="hidden rounded-full border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-400 sm:block">${safePokeUserId}</div>
          <button id="save-button" class="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200">Save</button>
        </div>
      </header>

      <section class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_1fr]">
        <aside class="hidden border-r border-neutral-800 bg-neutral-950 p-5 lg:block">
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Builder</p>
          <h2 class="mt-3 text-2xl font-semibold tracking-[-0.05em]">Node editing, without the mess.</h2>
          <p class="mt-3 text-sm leading-6 text-neutral-400">Pick a trigger, stack actions, and tune each node from the inspector. Variables like <span class="font-mono text-neutral-200">$userId</span> and <span class="font-mono text-neutral-200">$username</span> work in text fields.</p>
          <div class="mt-8 rounded-2xl border border-neutral-800 p-4">
            <p class="text-xs font-semibold text-neutral-500">Guild ID</p>
            <p class="mt-2 break-all font-mono text-xs text-neutral-300">${safeGuildId}</p>
          </div>
        </aside>

        <div class="min-h-0 overflow-y-auto px-5 py-8 sm:px-8">
          <div id="flow" class="mx-auto flex max-w-2xl flex-col items-center pb-24"></div>
        </div>
      </section>
    </main>

    <aside id="inspector" class="hidden w-full max-w-sm border-l border-neutral-800 bg-neutral-900 sm:block">
      <div class="border-b border-neutral-800 p-5">
        <p class="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Inspector</p>
        <h2 id="inspector-title" class="mt-2 text-lg font-semibold tracking-[-0.03em]">Select a node</h2>
      </div>
      <div id="inspector-body" class="space-y-5 p-5 text-sm text-neutral-400">
        Click the trigger or any action node to edit its settings.
      </div>
    </aside>
  </div>

  <div id="action-modal" class="fixed inset-0 hidden items-center justify-center bg-black/70 p-5">
    <div class="w-full max-w-lg rounded-3xl border border-neutral-800 bg-neutral-950 p-3">
      <div class="flex items-center justify-between px-3 py-2">
        <h3 class="text-sm font-semibold">Add an action</h3>
        <button id="close-modal" class="text-sm font-semibold text-neutral-500 hover:text-white">Close</button>
      </div>
      <div id="action-options" class="mt-2 grid gap-2"></div>
    </div>
  </div>

  <div id="toast" class="fixed bottom-6 left-1/2 hidden -translate-x-1/2 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"></div>

  <script>
    const GUILD_ID = "${safeGuildId}";
    const INITIAL_SCRIPT = ${initialScript};

    const flow = document.getElementById('flow');
    const title = document.getElementById('studio-title');
    const inspectorTitle = document.getElementById('inspector-title');
    const inspectorBody = document.getElementById('inspector-body');
    const saveButton = document.getElementById('save-button');
    const actionModal = document.getElementById('action-modal');
    const actionOptions = document.getElementById('action-options');
    const closeModal = document.getElementById('close-modal');
    const toast = document.getElementById('toast');

    let selected = { kind: 'trigger', index: -1 };
    let script = INITIAL_SCRIPT || {
      id: null,
      event_type: 'BUTTON_CLICK',
      trigger_id: 'open_ticket',
      actions: []
    };

    const triggers = [
      ['BUTTON_CLICK', 'Button Click', 'Runs when a Discord button custom ID is clicked.'],
      ['MESSAGE_CREATE', 'Message Sent', 'Runs when a message is sent in a selected channel.'],
      ['GUILD_MEMBER_ADD', 'Member Join', 'Runs when a member joins the server.'],
      ['MODAL_SUBMIT', 'Modal Submit', 'Runs after a modal form is submitted.'],
      ['WEBHOOK', 'Webhook', 'Runs from an incoming webhook endpoint.']
    ];

    const actionTypes = [
      { type: 'SEND_MESSAGE', name: 'Send Message', desc: 'Post a simple text message.', fields: [['channel_id', 'Channel ID', 'text'], ['content', 'Content', 'textarea'], ['ephemeral', 'Ephemeral reply', 'checkbox']] },
      { type: 'SEND_EMBED', name: 'Send Embed', desc: 'Post a rich Discord embed.', fields: [['channel_id', 'Channel ID', 'text'], ['embed.title', 'Embed title', 'text'], ['embed.description', 'Embed description', 'textarea'], ['embed.color', 'Color decimal', 'text']] },
      { type: 'ADD_ROLE', name: 'Add Role', desc: 'Give the triggering member a role.', fields: [['role_id', 'Role ID', 'text'], ['user_id', 'User ID override', 'text']] },
      { type: 'CREATE_CHANNEL', name: 'Create Channel', desc: 'Create a text channel.', fields: [['name', 'Channel name', 'text'], ['parent_id', 'Category ID', 'text'], ['initial_message', 'Initial message', 'textarea']] },
      { type: 'SHOW_MODAL', name: 'Show Modal', desc: 'Open a Discord modal form.', fields: [['custom_id', 'Modal custom ID', 'text'], ['title', 'Modal title', 'text']] },
      { type: 'DELETE_CHANNEL', name: 'Delete Channel', desc: 'Delete a channel by ID.', fields: [['channel_id', 'Channel ID', 'text']] }
    ];

    function escapeHtml(value) {
      return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.remove('hidden');
      window.setTimeout(() => toast.classList.add('hidden'), 2400);
    }

    function niceType(type) {
      return String(type || 'Unknown').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    function getByPath(object, path) {
      return path.split('.').reduce(function(acc, key) { return acc && acc[key] !== undefined ? acc[key] : ''; }, object);
    }

    function setByPath(object, path, value) {
      const parts = path.split('.');
      let target = object;
      while (parts.length > 1) {
        const part = parts.shift();
        target[part] = target[part] && typeof target[part] === 'object' ? target[part] : {};
        target = target[part];
      }
      target[parts[0]] = value;
    }

    function renderFlow() {
      title.textContent = script.id ? 'Edit script' : 'New script';
      flow.innerHTML = '';
      flow.appendChild(renderNode('trigger', -1, 'Trigger', niceType(script.event_type), script.trigger_id || 'All matching events'));

      script.actions.forEach(function(action, index) {
        const line = document.createElement('div');
        line.className = 'node-line';
        flow.appendChild(line);
        flow.appendChild(renderNode('action', index, 'Action ' + (index + 1), niceType(action.type), summarizeAction(action)));
      });

      const line = document.createElement('div');
      line.className = 'node-line';
      flow.appendChild(line);

      const add = document.createElement('button');
      add.className = 'node-enter rounded-full border border-dashed border-neutral-700 px-5 py-3 text-sm font-semibold text-neutral-400 transition-colors hover:border-white hover:text-white';
      add.type = 'button';
      add.textContent = '+ Add action';
      add.onclick = openActionModal;
      flow.appendChild(add);
    }

    function renderNode(kind, index, eyebrow, name, detail) {
      const isSelected = selected.kind === kind && selected.index === index;
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'node-enter w-full rounded-3xl border bg-neutral-900 p-5 text-left transition-transform hover:-translate-y-0.5 ' + (isSelected ? 'border-white' : 'border-neutral-800 hover:border-neutral-600');
      node.onclick = function() { selectNode(kind, index); };
      node.innerHTML = '<div class="flex items-start justify-between gap-4">'
        + '<div><p class="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">' + escapeHtml(eyebrow) + '</p>'
        + '<h3 class="mt-2 text-base font-semibold text-white">' + escapeHtml(name) + '</h3>'
        + '<p class="mt-2 text-sm text-neutral-400">' + escapeHtml(detail) + '</p></div>'
        + '<span class="rounded-full border border-neutral-800 px-2 py-1 text-xs font-semibold text-neutral-500">Edit</span>'
        + '</div>';
      return node;
    }

    function summarizeAction(action) {
      if (action.type === 'SEND_MESSAGE') return action.content || 'Message content not set';
      if (action.type === 'SEND_EMBED') return (action.embed && (action.embed.title || action.embed.description)) || 'Embed details not set';
      if (action.type === 'ADD_ROLE') return action.role_id || 'Role ID not set';
      if (action.type === 'CREATE_CHANNEL') return action.name || 'Channel name not set';
      if (action.type === 'SHOW_MODAL') return action.title || action.custom_id || 'Modal details not set';
      return 'Configure this action';
    }

    function selectNode(kind, index) {
      selected = { kind: kind, index: index };
      renderFlow();
      if (kind === 'trigger') renderTriggerInspector();
      else renderActionInspector(index);
    }

    function field(label, html) {
      return '<label class="block"><span class="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">' + label + '</span>' + html + '</label>';
    }

    function renderTriggerInspector() {
      inspectorTitle.textContent = 'Trigger';
      inspectorBody.innerHTML = field('Event type', '<select id="event-type" class="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-neutral-500">' + triggers.map(function(trigger) {
        return '<option value="' + trigger[0] + '" ' + (script.event_type === trigger[0] ? 'selected' : '') + '>' + trigger[1] + '</option>';
      }).join('') + '</select>')
      + field('Trigger ID', '<input id="trigger-id" value="' + escapeHtml(script.trigger_id || '') + '" placeholder="Use * for all, or a button/channel/custom ID" class="mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 font-mono text-xs text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-500">')
      + '<p class="text-sm leading-6 text-neutral-400">The trigger ID is usually a button custom ID, channel ID, modal custom ID, provider name, or <span class="font-mono text-neutral-200">*</span>.</p>';

      document.getElementById('event-type').onchange = function(event) {
        script.event_type = event.target.value;
        renderFlow();
      };
      document.getElementById('trigger-id').oninput = function(event) {
        script.trigger_id = event.target.value;
        renderFlow();
      };
    }

    function renderActionInspector(index) {
      const action = script.actions[index];
      const definition = actionTypes.find(function(item) { return item.type === action.type; });
      inspectorTitle.textContent = niceType(action.type);

      const fields = definition ? definition.fields : [];
      inspectorBody.innerHTML = fields.map(function(item) {
        const key = item[0];
        const label = item[1];
        const type = item[2];
        const value = getByPath(action, key);
        if (type === 'textarea') {
          return field(label, '<textarea data-path="' + key + '" rows="4" class="studio-input mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-500">' + escapeHtml(value) + '</textarea>');
        }
        if (type === 'checkbox') {
          return '<label class="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5"><span class="text-sm font-medium text-white">' + label + '</span><input data-path="' + key + '" type="checkbox" class="studio-input" ' + (value ? 'checked' : '') + '></label>';
        }
        return field(label, '<input data-path="' + key + '" value="' + escapeHtml(value) + '" class="studio-input mt-2 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-500">');
      }).join('') + '<div class="border-t border-neutral-800 pt-5"><button id="remove-action" type="button" class="w-full rounded-xl border border-red-950 bg-red-950/30 px-3 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:border-red-800 hover:bg-red-950/50">Remove action</button></div>';

      inspectorBody.querySelectorAll('.studio-input').forEach(function(input) {
        input.addEventListener('input', function(event) {
          const target = event.target;
          setByPath(action, target.dataset.path, target.type === 'checkbox' ? target.checked : target.value);
          renderFlow();
        });
      });
      document.getElementById('remove-action').onclick = function() {
        script.actions.splice(index, 1);
        selected = { kind: 'trigger', index: -1 };
        renderFlow();
        renderTriggerInspector();
      };
    }

    function openActionModal() {
      actionOptions.innerHTML = actionTypes.map(function(action) {
        return '<button type="button" data-type="' + action.type + '" class="action-option rounded-2xl border border-neutral-800 p-4 text-left transition-colors hover:border-neutral-500 hover:bg-neutral-900">'
          + '<p class="text-sm font-semibold text-white">' + action.name + '</p>'
          + '<p class="mt-1 text-sm text-neutral-400">' + action.desc + '</p>'
          + '</button>';
      }).join('');
      actionModal.classList.remove('hidden');
      actionModal.classList.add('flex');
      actionOptions.querySelectorAll('.action-option').forEach(function(button) {
        button.onclick = function() { addAction(button.dataset.type); };
      });
    }

    function addAction(type) {
      const next = { type: type };
      if (type === 'SEND_MESSAGE') next.content = 'Hello $username';
      if (type === 'SEND_EMBED') next.embed = { title: 'Title', description: 'Description' };
      script.actions.push(next);
      actionModal.classList.add('hidden');
      actionModal.classList.remove('flex');
      selectNode('action', script.actions.length - 1);
    }

    closeModal.onclick = function() {
      actionModal.classList.add('hidden');
      actionModal.classList.remove('flex');
    };

    saveButton.onclick = async function() {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';
      try {
        const isUpdate = Boolean(script.id);
        const response = await fetch(isUpdate ? '/api/scripts/' + encodeURIComponent(script.id) : '/api/servers/' + encodeURIComponent(GUILD_ID) + '/scripts', {
          method: isUpdate ? 'PUT' : 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: script.event_type,
            trigger_id: script.trigger_id || null,
            actions: script.actions,
            active: script.active !== false
          })
        });
        if (!response.ok) throw new Error('Save failed');
        const payload = await response.json();
        script = payload.script;
        window.history.replaceState({}, '', '/dashboard/studio/' + encodeURIComponent(GUILD_ID) + '/' + encodeURIComponent(script.id));
        showToast('Automation saved');
        renderFlow();
      } catch (error) {
        showToast('Could not save script');
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save';
      }
    };

    renderFlow();
    selectNode('trigger', -1);
  </script>
</body>
</html>`;
}

studioRouter.get("/:guild_id", async (req: Request, res: Response) => {
  const pokeUserId = getPokeUserIdFromRequest(req);
  if (!pokeUserId) {
    res.redirect("/auth");
    return;
  }

  const guildId = String(req.params.guild_id);
  const linked = await isGuildLinkedToPokeUser(pokeUserId, guildId);
  if (!linked) {
    res.status(403).send("Server is not linked to this Poke user");
    return;
  }

  res.type("html").send(renderStudioPage(pokeUserId, guildId, null));
});

studioRouter.get(
  "/:guild_id/:script_id",
  async (req: Request, res: Response) => {
    const pokeUserId = getPokeUserIdFromRequest(req);
    if (!pokeUserId) {
      res.redirect("/auth");
      return;
    }

    const guildId = String(req.params.guild_id);
    const scriptId = String(req.params.script_id);

    try {
      const linked = await isGuildLinkedToPokeUser(pokeUserId, guildId);
      if (!linked) {
        res.status(403).send("Server is not linked to this Poke user");
        return;
      }

      const script = await getAutomationScriptById(scriptId);
      if (
        !script ||
        script.poke_user_id !== pokeUserId ||
        script.discord_guild_id !== guildId
      ) {
        res.status(404).send("Script not found");
        return;
      }

      res.type("html").send(renderStudioPage(pokeUserId, guildId, script));
    } catch (err) {
      console.error("[studio] Failed to load script:", err);
      res.status(500).send("Failed to load studio");
    }
  },
);
