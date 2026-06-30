-- Discord OAuth login + MCP OAuth persistence.
-- poke_user_id throughout the app = app_users.id (Discord user snowflake).

-- ---------------------------------------------------------------------------
-- App users (identity from Discord OAuth login)
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id                  text primary key,
  discord_username    text,
  discord_global_name text,
  discord_avatar      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_app_users_username
  on public.app_users (discord_username);

alter table public.app_users enable row level security;

-- ---------------------------------------------------------------------------
-- Web sessions (dashboard, studio, OAuth resume)
-- ---------------------------------------------------------------------------
create table if not exists public.user_sessions (
  id             uuid primary key default gen_random_uuid(),
  session_token  text not null unique,
  user_id        text not null references public.app_users(id) on delete cascade,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_user_sessions_token
  on public.user_sessions (session_token);

create index if not exists idx_user_sessions_user
  on public.user_sessions (user_id);

create index if not exists idx_user_sessions_expires
  on public.user_sessions (expires_at);

alter table public.user_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- MCP OAuth clients (dynamic registration)
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_clients (
  client_id      text primary key,
  client_secret  text,
  client_name    text,
  redirect_uris  text[] not null default '{}',
  created_at     timestamptz not null default now()
);

alter table public.oauth_clients enable row level security;

-- ---------------------------------------------------------------------------
-- MCP OAuth authorization codes (PKCE)
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_authorization_codes (
  code             text primary key,
  client_id        text not null references public.oauth_clients(client_id) on delete cascade,
  redirect_uri     text not null,
  user_id          text not null references public.app_users(id) on delete cascade,
  scope            text not null default 'mcp',
  code_challenge   text not null,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_oauth_auth_codes_expires
  on public.oauth_authorization_codes (expires_at);

alter table public.oauth_authorization_codes enable row level security;

-- ---------------------------------------------------------------------------
-- MCP OAuth access tokens (Bearer auth for /mcp)
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_access_tokens (
  token        text primary key,
  client_id    text not null,
  user_id      text not null references public.app_users(id) on delete cascade,
  scope        text not null default 'mcp',
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_oauth_access_tokens_user
  on public.oauth_access_tokens (user_id);

create index if not exists idx_oauth_access_tokens_expires
  on public.oauth_access_tokens (expires_at);

alter table public.oauth_access_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at trigger for app_users
-- ---------------------------------------------------------------------------
drop trigger if exists app_users_updated_at on public.app_users;

create trigger app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Optional FK: tie discord_account_links.poke_user_id to app_users when present
-- (poke_user_id remains text for backward compatibility with existing rows)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'discord_account_links_poke_user_fkey'
  ) then
    alter table public.discord_account_links
      add constraint discord_account_links_poke_user_fkey
      foreign key (poke_user_id) references public.app_users(id) on delete cascade
      not valid;
  end if;
end $$;
