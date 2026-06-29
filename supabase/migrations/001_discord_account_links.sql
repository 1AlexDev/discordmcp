-- Links a Poke user to a Discord guild after OAuth + bot install.
-- Access is service-role only from the backend (RLS enabled, no public policies).

create table public.discord_account_links (
  id                  uuid primary key default gen_random_uuid(),
  poke_user_id        text not null,
  discord_user_id     text not null,
  discord_guild_id    text not null,
  discord_username    text,
  access_token        text not null,
  refresh_token       text,
  token_expires_at    timestamptz,
  bot_permissions     bigint,
  linked_at           timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.discord_account_links
  add constraint discord_account_links_poke_user_guild_unique
  unique (poke_user_id, discord_guild_id);

create index idx_discord_account_links_poke_user
  on public.discord_account_links (poke_user_id);

create index idx_discord_account_links_guild
  on public.discord_account_links (discord_guild_id);

alter table public.discord_account_links enable row level security;

-- Auto-update updated_at on row changes
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger discord_account_links_updated_at
  before update on public.discord_account_links
  for each row execute function public.set_updated_at();
