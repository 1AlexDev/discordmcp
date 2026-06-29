# Poke Discord MCP — Project Roadmap

> **Source of truth** for AI agents and developers working on this project.
> Last updated: 2026-06-29

---

## Project Goals

Build a **custom Model Context Protocol (MCP) server** that lets the **Poke AI** fully manage a user's Discord server after they:

1. Invite our Discord bot to their server.
2. Link their Poke account to the Discord MCP service via OAuth2.
3. Use MCP tools (with `pokeUserId`) to perform server actions scoped to their linked guild.

---

## Architecture Overview (Unified Single-Port)

Production and local dev run **one Node process** on a **single HTTP port** (`PORT`, default 3000; Render injects dynamically):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Unified Express Server (PORT)                           │
│  GET  /health   GET  /auth   GET  /callback   POST  /mcp                    │
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

**OAuth linking URL:** `{BASE_URL}/auth?poke_user_id=<id>`

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

Every tool **requires** `pokeUserId: string`.

| Tool | Description |
|------|-------------|
| `list_channels` | List channels in linked guild |
| `send_message` | Send message to channel |
| `create_channel` | Create text/voice channel |
| `kick_user` | Kick member by ID |
| `ban_user` | Ban member by ID |
| `create_role` | Create role with color/permissions |
| `assign_role` | Assign role to member |

---

## Feature Checklist

### Phase 0 — Planning & Roadmap
- [x] Create `roadmap.md`

### Phase 1 — Project Setup
- [x] TypeScript project, dependencies, Supabase migration, build scripts

### Phase 2 — OAuth Linking
- [x] `/auth`, `/callback`, signed OAuth state
- [ ] Token refresh helper (optional v1.1)

### Phase 3 — Bot Integration
- [x] discord.js client + DiscordManager

### Phase 4 — MCP Tools
- [x] All 7 tools, guild resolver, Zod schemas

### Phase 5 — Hardening & Deploy
- [x] Health check, README, logging
- [x] **Unified single-port architecture** (OAuth + MCP on one Express server)
- [x] **`render.yaml` blueprint** for one-click Render deploy
- [x] Production docs (Poke Recipe Server URL = `{BASE_URL}/mcp`)
- [ ] Manual E2E test on Render after env configuration

---

## Current Progress

**Status:** Production-ready for Render. Unified server on single `PORT`; deploy via `render.yaml`.

**Next step:** Deploy to Render, set `BASE_URL` to Render URL, configure Poke Recipe Server URL to `{BASE_URL}/mcp`, run OAuth linking E2E test.

---

## Notes for AI Agents

1. **Always read this file first** before making changes.
2. Do **not** reintroduce a separate MCP port — Render exposes one port per web service.
3. Every MCP tool must accept `pokeUserId` and resolve guild via Supabase.
4. `BASE_URL` drives OAuth links, redirect URI derivation, and Poke MCP Server URL.
5. Never log or commit secrets.
