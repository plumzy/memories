create extension if not exists "pgcrypto";

create table if not exists public.folders (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  name text not null,
  cover_media_id text,
  rotation_media_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.folders
add column if not exists rotation_media_ids uuid[] not null default '{}';

create table if not exists public.media_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  folder_id text not null references public.folders(id) on delete cascade,
  storage_key text not null,
  thumbnail_storage_key text,
  url text not null,
  thumbnail_url text,
  caption text,
  author text,
  included_in_carousel boolean not null default false,
  carousel_order integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.carousel_settings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  mode text not null default 'all' check (mode in ('all', 'folders', 'selected')),
  selected_ids uuid[] not null default '{}',
  playing boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.audio_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  storage_key text not null,
  url text not null,
  title text not null,
  file_name text,
  content_type text,
  size bigint,
  active boolean not null default false,
  playlist_order integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_user_id_idx on public.folders(user_id);
create index if not exists media_items_user_id_idx on public.media_items(user_id);
create index if not exists media_items_folder_id_idx on public.media_items(folder_id);
create index if not exists media_items_carousel_idx on public.media_items(user_id, included_in_carousel, carousel_order);
create index if not exists media_items_file_hash_idx on public.media_items ((metadata->>'fileHash'));
create index if not exists audio_items_user_id_idx on public.audio_items(user_id);
create index if not exists audio_items_active_idx on public.audio_items(user_id, active, playlist_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at
before update on public.folders
for each row execute function public.set_updated_at();

drop trigger if exists media_items_set_updated_at on public.media_items;
create trigger media_items_set_updated_at
before update on public.media_items
for each row execute function public.set_updated_at();

drop trigger if exists carousel_settings_set_updated_at on public.carousel_settings;
create trigger carousel_settings_set_updated_at
before update on public.carousel_settings
for each row execute function public.set_updated_at();

drop trigger if exists audio_items_set_updated_at on public.audio_items;
create trigger audio_items_set_updated_at
before update on public.audio_items
for each row execute function public.set_updated_at();

alter table public.folders enable row level security;
alter table public.media_items enable row level security;
alter table public.carousel_settings enable row level security;
alter table public.audio_items enable row level security;

drop policy if exists "Service role manages folders" on public.folders;
create policy "Service role manages folders"
on public.folders
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Service role manages media" on public.media_items;
create policy "Service role manages media"
on public.media_items
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Service role manages carousel" on public.carousel_settings;
create policy "Service role manages carousel"
on public.carousel_settings
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Service role manages audio" on public.audio_items;
create policy "Service role manages audio"
on public.audio_items
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into public.folders (id, user_id, name)
values ('default', 'anniversary', 'Memories')
on conflict (id) do nothing;

insert into public.carousel_settings (user_id, mode, playing)
values ('anniversary', 'all', true)
on conflict (user_id) do nothing;
