# Discord MCP

Discord integration for the Model Context Protocol (MCP). Orchestrate Discord servers via AI.

## Core
- **Single Port**: Unified HTTP server for OAuth, health, and MCP.
- **Identity**: Discord OAuth 2.0 with account linking.
- **Auth**: MCP OAuth 2.1 (PKCE) for remote clients; legacy Poke headers supported.
- **Batching**: `run_batch` tool for atomic multi-action requests over SSE.
- **Storage**: Supabase persistence for user-guild mappings.

## Setup

### Environment
```bash
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
BASE_URL=http://localhost:3000
OAUTH_STATE_SECRET=
```

### Endpoints
- `POST /mcp` — Streamable HTTP / SSE transport.
- `GET /auth/login` — Initiates user session.
- `GET /auth/link` — Bot installation and guild binding.
- `GET /.well-known/oauth-authorization-server` — MCP OAuth discovery.

## Tools
| Tool | Description |
|:---|:---|
| `run_batch` | Execute multiple tools in one request. |
| `list_channels` | Return guild channel list. |
| `send_message` | Dispatch message to a channel. |
| `create_channel` | Create text or voice channel. |
| `kick_user` | Remove member from guild. |
| `ban_user` | Ban member from guild. |
| `create_role` | Provision new role. |
| `assign_role` | Bind role to user. |

## Deployment
Render-native. Use `render.yaml` for blueprint deployment.
- **Build**: `npm install && npm run build`
- **Start**: `npm run start`

## Development
```bash
npm run dev        # hot reload
npm run typecheck  # validation
```
