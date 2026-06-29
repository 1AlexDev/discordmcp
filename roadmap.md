# Poke Discord MCP — Project Roadmap

> **Source of truth** for AI agents and developers working on this project.
> Last updated: 2026-06-29

---

## Project Goals

Build a **custom Model Context Protocol (MCP) server** that lets the **Poke AI** fully manage a user's Discord server after they:

1. Invite our Discord bot to their server.
2. Link their Poke account to the Discord MCP service via OAuth2.
3. Use MCP tools to perform server actions scoped to their linked guild; Poke identity is injected through request headers.

---

## Architecture Overview (Unified Single-Port)

Production and local dev run **one Node process** on a **single HTTP port** (`PORT`, default 3000; Render injects dynamically):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Unified Express Server (PORT)                           │
│ GET /health  GET /auth  GET /dashboard  GET /callback  GET /api/*  POST /mcp│
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────────┐
│ MCP Tool Router  │    │ Supabase (Postgres)│    │ discord.js bot (same     │
│ (Zod + resolver) │    │ account links      │    │ process, background)     │
└──────────────────┘    └──────────────────┘    └──────────────────────────┘
```

**Poke Recipe Server URL:** `{BASE_URL}/mcp` (e.g. `https://your-app.onrender.com/mcp`)

**OAuth linking URL:** `{BASE_URL}/auth`

**Dashboard URL:** `{BASE_URL}/dashboard` (uses `poke_user_id` query/header or HTTP-only cookie)

**Discord redirect URI:** `{BASE_URL}/callback` (or explicit `DISCORD_REDIRECT_URI`)

See [README.md](README.md) and [render.yaml](render.yaml) for deployment.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_CLIENT_ID` | Yes | Discord application client ID |
| `DISCORD_CLIENT_SECRET` | Yes | Discord application client secret |
| `DISCORD_TOKEN` | Yes | Bot token (discord.js login) |
| `DISCORD_REDIRECT_URI` | No | OAuth callback — defaults to `{BASE_URL}/callback` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (server-side only) |
| `BASE_URL` | Yes | Public origin (e.g. `https://your-app.onrender.com`) |
| `PORT` | No | Listen port — Render injects; defaults to `3000` |
| `MCP_TRANSPORT` | No | `sse` (production, default) \| `stdio` (local Cursor) |
| `NODE_ENV` | No | `development` \| `production` |
| `OAUTH_STATE_SECRET` | Yes (prod) | HMAC secret for OAuth state signing |

**Removed:** `MCP_PORT` — MCP shares the unified `PORT`.

---

## MCP Tools (v1)

Tool schemas do **not** expose `pokeUserId`. Poke sends `X-Poke-User-Id` on each `/mcp` request, and the Express transport layer stores it in `AsyncLocalStorage` so tool handlers can resolve the linked Discord guild transparently.

The service is public and multi-tenant. User isolation is based on the Poke user ID from the request context plus the Supabase `poke_user_id` to `discord_guild_id` mapping. A single Poke user can link multiple Discord guilds; MCP tools currently default to the most recently updated linked guild. If no mapping exists, the tool returns `NOT_LINKED`.

| Tool | Description |
|------|-------------|
| `list_channels` | List channels in linked guild |
| `send_message` | Send message to channel |
| `create_channel` | Create text/voice channel |
| `kick_user` | Kick member by ID |
| `ban_user` | Ban member by ID |
| `create_role` | Create role with color/permissions |
| `assign_role` | Assign role to member |
| `get_users` | List or search members in linked guild |
| `get_roles` | Fetch all available roles in linked guild |
| `read_messages` | Read recent messages from a channel |
| `get_server_info` | High-level server statistics |
| `get_categories` | List all categories |
| `create_category`| Create a category |
| `delete_category` | Delete a category |
| `get_channel` | Fetch detailed channel info |
| `delete_channel` | Delete a channel |
| `update_channel` | Update channel name, topic, or parent |
| `delete_message` | Delete a message |
| `edit_message` | Edit an existing message |
| `send_embed_message`| Send a rich embed message |
| `send_component_message` | Send message with buttons/select menus |
| `send_components_v2_message` | Send advanced layout Components V2 message |
| `create_automod_rule` | Create an AutoMod rule |
| `edit_role` | Update role name, color, and permissions |
| `create_automation_script` | Create a database-driven automation script |
| `list_automation_scripts` | List automation scripts for linked guild |
| `delete_automation_script` | Delete an automation script |
| `edit_channel_permissions` | Edit channel role/user permission overwrites |
| `create_webhook` | Create a Discord webhook |
| `execute_webhook` | Send a message through a webhook |
| `add_reaction` | Add a reaction to a message |
| `remove_reaction` | Remove the bot's reaction from a message |

---

## Feature Checklist

### Phase 0 — Planning & Roadmap
- [x] Create `roadmap.md`

### Phase 1 — Project Setup
- [x] TypeScript project, dependencies, Supabase migration, build scripts

### Phase 2 — OAuth Linking
- [x] `/auth`, `/callback`, signed OAuth state
- [x] Web UI for `/auth` endpoint
- [x] Multi-server dashboard at `/dashboard`
- [x] Dashboard session cookie for linked Poke users
- [ ] Token refresh helper (optional v1.1)

### Phase 3 — Bot Integration
- [x] discord.js client + DiscordManager

### Phase 4 — MCP Tools
- [x] Initial 7 administrative tools, guild resolver, Zod schemas
- [x] New read-only data fetching tools (`get_users`, `get_roles`, `read_messages`, `get_server_info`)
- [x] Advanced management tools (`get_categories`, `delete_category`, `get_channel`, `delete_channel`, `update_channel`)
- [x] Rich messaging tools (`send_embed_message`, `send_component_message`)
- [x] Advanced Moderation (`delete_message`, `edit_message`, `create_automod_rule`, `edit_role`, `create_category`)
- [x] Components V2 Implementation (`send_components_v2_message`)
- [x] Database-driven automation scripting tools (`create_automation_script`, `list_automation_scripts`, `delete_automation_script`)
- [x] Advanced webhook, permission, and reaction tools (`edit_channel_permissions`, `create_webhook`, `execute_webhook`, `add_reaction`, `remove_reaction`)

### Phase 5 — Hardening & Deploy
- [x] 1:many account-link architecture (`poke_user_id`, `discord_guild_id` unique pair)
- [x] Dashboard API endpoint (`GET /api/user/servers`)
- [x] Automation scripts schema (`automation_scripts`)
- [x] Dynamic Discord event automation engine (`interactionCreate`, `messageCreate`, `guildMemberAdd`)
- [x] Dashboard Script Management UI (`GET /api/servers/:guild_id/scripts`, `DELETE /api/scripts/:script_id`)
- [x] Health check, README, logging
- [x] **Unified single-port architecture** (OAuth + MCP on one Express server)
- [x] **`render.yaml` blueprint** for one-click Render deploy
- [x] Production docs (Poke Recipe Server URL = `{BASE_URL}/mcp`)
- [ ] Manual E2E test on Render after env configuration

---

## Current Progress

**Status:** Production-ready for Render. Unified server on single `PORT`; deploy via `render.yaml`. MCP identity is request-scoped through Poke headers instead of manual tool parameters. Account links now support multiple Discord servers per Poke user, with `/dashboard` for public connection management.

**Next step:** Apply Supabase migrations, deploy to Render, set `BASE_URL` to Render URL, configure Poke Recipe Server URL to `{BASE_URL}/mcp`, run OAuth/dashboard E2E tests.

---

## Notes for AI Agents

1. **Always read this file first** before making changes.
2. Do **not** reintroduce a separate MCP port — Render exposes one port per web service.
3. Do **not** add `pokeUserId` to MCP tool schemas. Resolve it from the `X-Poke-User-Id` request context and then query Supabase. If multiple guilds are linked, the resolver uses the most recently updated account link by default.
4. `BASE_URL` drives OAuth links, redirect URI derivation, and Poke MCP Server URL.
5. Never log or commit secrets.
