-- Allows one Poke user to link multiple Discord guilds.
-- Existing installs created a unique constraint on poke_user_id; remove it and
-- replace it with a composite uniqueness constraint per Poke user + guild.

alter table public.discord_account_links
  drop constraint if exists discord_account_links_poke_user_id_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'discord_account_links_poke_user_guild_unique'
  ) then
    alter table public.discord_account_links
      add constraint discord_account_links_poke_user_guild_unique
      unique (poke_user_id, discord_guild_id);
  end if;
end $$;

create index if not exists idx_discord_account_links_poke_user
  on public.discord_account_links (poke_user_id);
