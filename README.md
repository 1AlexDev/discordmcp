# Poke Discord MCP

Custom [Model Context Protocol](https://modelcontextprotocol.io/) server that lets the **Poke AI** manage a user's Discord server after OAuth linking.

## Features

- **Unified HTTP server** — OAuth, health, and MCP on a **single port** (Render-compatible)
- **OAuth account linking** — Connect a Poke user to a Discord guild via `/auth`
- **Discord bot** — Executes all actions through `discord.js` in the same process
- **7 MCP tools** — Channels, messages, roles, kicks, bans (all scoped by `pokeUserId`)
- **Supabase storage** — Persists `poke_user_id` ↔ `discord_guild_id` mappings

## Architecture (Production)

```
Single process on PORT (Render-injected or 3000 locally)
├── GET  /health     → health check
├── GET  /auth       → Discord OAuth (start linking)
├── GET  /callback   → Discord OAuth callback
├── POST /mcp        → MCP Streamable HTTP (Poke Recipe Server URL)
└── discord.js bot   → background gateway connection
```

## Quick Start (Local)

### 1. Discord Application

1. Create an app at [Discord Developer Portal](https://discord.com/developers/applications)
2. Add a **Bot** and copy the token → `DISCORD_TOKEN`
3. Copy **Client ID** and **Client Secret**
4. Under OAuth2, add redirect URI: `http://localhost:3000/callback`

### 2. Supabase

Run [supabase/migrations/001_discord_account_links.sql](supabase/migrations/001_discord_account_links.sql) in your project.

### 3. Environment

```bash
cp .env.example .env
# Fill in DISCORD_*, SUPABASE_*, BASE_URL, OAUTH_STATE_SECRET
```

### 4. Run

```bash
npm install
npm run dev
```

All endpoints on **one port** (default `3000`):

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Health check |
| `GET /auth?poke_user_id=<id>` | Start Discord OAuth linking |
| `GET /callback` | OAuth redirect target |
| `POST /mcp` | MCP Streamable HTTP (Poke integration) |

## Poke Recipe Integration

In the Poke Recipe MCP configuration, set the **Server URL** to your public MCP endpoint:

```
https://your-app.onrender.com/mcp
```

Use your Render service URL (or local `http://localhost:3000/mcp` for dev). This single URL is the Streamable HTTP / SSE transport endpoint — Poke sends MCP JSON-RPC requests here.

Also configure in Render / `.env`:

| Variable | Production example |
|----------|-------------------|
| `BASE_URL` | `https://your-app.onrender.com` |
| `MCP_TRANSPORT` | `sse` |
| `DISCORD_REDIRECT_URI` | *(optional)* defaults to `{BASE_URL}/callback` |

Register the same callback URL in the Discord Developer Portal:
`https://your-app.onrender.com/callback`

## Deploy to Render

### One-click blueprint

1. Push this repo to GitHub
2. In [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**
3. Connect the repo — Render reads [render.yaml](render.yaml)
4. Fill in environment variables when prompted:

| Variable | Required |
|----------|----------|
| `DISCORD_CLIENT_ID` | Yes |
| `DISCORD_CLIENT_SECRET` | Yes |
| `DISCORD_TOKEN` | Yes |
| `SUPABASE_URL` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes |
| `BASE_URL` | Yes — your Render URL, e.g. `https://poke-discord-mcp.onrender.com` |
| `OAUTH_STATE_SECRET` | Yes — random 32+ char secret |
| `DISCORD_REDIRECT_URI` | No — auto-derived from `BASE_URL` |

5. Update Discord OAuth redirect URI to match `{BASE_URL}/callback`
6. Set Poke Recipe Server URL to `{BASE_URL}/mcp`

Render injects `PORT` automatically — do not hardcode it.

### Manual deploy

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run start`
- **Health check path:** `/health`

## Linking Flow

1. User visits: `{BASE_URL}/auth?poke_user_id=<poke-user-id>`
2. Discord OAuth — user selects server and authorizes bot
3. Callback saves link to Supabase
4. Poke AI calls MCP tools at `{BASE_URL}/mcp` with that `pokeUserId`

## MCP Tools

All tools require `pokeUserId`:

| Tool | Description |
|------|-------------|
| `list_channels` | List guild channels |
| `send_message` | Send message to a channel |
| `create_channel` | Create text/voice channel |
| `kick_user` | Kick member by ID |
| `ban_user` | Ban member by ID |
| `create_role` | Create role with color/permissions |
| `assign_role` | Assign role to member |

## Cursor Integration (stdio)

For local Cursor MCP (not production), set `MCP_TRANSPORT=stdio`. The HTTP server still runs for OAuth; MCP uses stdio:

```json
{
  "mcpServers": {
    "poke-discord": {
      "command": "node",
      "args": ["--import", "tsx", "src/index.ts"],
      "cwd": "/path/to/discordmcp",
      "env": {
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output (`dist/index.js`) |
| `npm run typecheck` | Type-check without emit |

See [roadmap.md](roadmap.md) for full architecture and progress.
