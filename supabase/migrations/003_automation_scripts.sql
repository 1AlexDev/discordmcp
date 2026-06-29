-- Database-driven Discord automation scripts.
-- Scripts are scoped to a Poke user and a linked Discord guild.

create table if not exists public.automation_scripts (
  id                 uuid primary key default gen_random_uuid(),
  poke_user_id       text not null,
  discord_guild_id   text not null,
  event_type         text not null,
  trigger_id         text,
  actions            jsonb not null default '[]'::jsonb,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_automation_scripts_guild_event_trigger
  on public.automation_scripts (discord_guild_id, event_type, trigger_id)
  where active = true;

create index if not exists idx_automation_scripts_poke_user
  on public.automation_scripts (poke_user_id);

alter table public.automation_scripts enable row level security;

create trigger automation_scripts_updated_at
  before update on public.automation_scripts
  for each row execute function public.set_updated_at();
