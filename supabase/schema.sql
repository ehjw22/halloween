-- Halloween wait-time board + student stamp cards
-- Run in the Supabase SQL editor, then enable Realtime for scare_houses.

create table if not exists public.scare_houses (
  id text primary key,
  name text not null,
  wait_minutes integer not null default 0 check (wait_minutes >= 0),
  status text not null default 'open'
    check (status in ('open', 'busy', 'closed', 'at_capacity')),
  updated_at timestamptz not null default now()
);

alter table public.scare_houses enable row level security;

drop policy if exists "public read scare houses" on public.scare_houses;
create policy "public read scare houses"
  on public.scare_houses for select
  using (true);

drop policy if exists "public upsert scare houses" on public.scare_houses;
drop policy if exists "public update scare houses" on public.scare_houses;

insert into public.scare_houses (id, name, wait_minutes, status) values
  ('dover-gate', 'Dover Gate Ghouls', 5, 'open'),
  ('aerohub', 'Aerohub Crypt', 20, 'busy'),
  ('innovillage', 'Innovillage Incubus', 10, 'open'),
  ('sports-complex', 'Trackside Terror', 0, 'open'),
  ('mp-field', 'Fog on the Field', 15, 'busy'),
  ('atrium', 'Atrium Abyss (T12)', 25, 'busy'),
  ('witch-labs', 'T11 Witch Labs', 8, 'open'),
  ('library', 'Library of Lost Souls', 35, 'at_capacity'),
  ('admin', 'Admin Hex', 12, 'open'),
  ('plaza', 'Plaza Phantom', 18, 'busy'),
  ('arena', 'Sports Arena Haunt', 22, 'busy'),
  ('moberly', 'Moberly Manor', 6, 'open'),
  ('west-wing', 'West Wing Wraiths', 0, 'closed'),
  ('food-court', 'FC Cursed Kitchen', 9, 'open'),
  ('wsa', 'WSA Warehouse Whispers', 40, 'at_capacity')
on conflict (id) do nothing;

create table if not exists public.students (
  student_number text primary key,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stamp_cards (
  student_number text primary key references public.students (student_number) on delete cascade,
  stamps jsonb not null default '{}'::jsonb,
  redeemed_at timestamptz,
  redeemed_by text,
  updated_at timestamptz not null default now()
);

alter table public.students enable row level security;
alter table public.stamp_cards enable row level security;

-- Browser never writes these tables. APIs use the service role (bypasses RLS)
-- or the anon key with the policies below as a fallback.
drop policy if exists "anon read students" on public.students;
create policy "anon read students"
  on public.students for select using (true);
drop policy if exists "anon insert students" on public.students;
drop policy if exists "anon insert cards" on public.stamp_cards;
drop policy if exists "anon update cards" on public.stamp_cards;
drop policy if exists "anon insert scores" on public.game_scores;
drop policy if exists "anon update scores" on public.game_scores;
drop policy if exists "anon insert feedback" on public.event_feedback;
drop policy if exists "anon insert announcements" on public.announcements;
drop policy if exists "anon update announcements" on public.announcements;
-- Writes go through Vercel APIs with the service role (bypasses RLS).
-- Browsers with the anon key can only read.

drop policy if exists "anon read cards" on public.stamp_cards;
create policy "anon read cards"
  on public.stamp_cards for select using (true);

create table if not exists public.game_scores (
  student_number text not null references public.students (student_number) on delete cascade,
  game_id text not null check (game_id in ('clicker', 'memory', 'catch')),
  score integer not null default 0 check (score >= 0),
  updated_at timestamptz not null default now(),
  primary key (student_number, game_id)
);

alter table public.game_scores enable row level security;

drop policy if exists "anon read scores" on public.game_scores;
create policy "anon read scores"
  on public.game_scores for select using (true);

do $$
begin
  alter publication supabase_realtime add table public.scare_houses;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create table if not exists public.event_feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('scare_house', 'booth')),
  target_id text not null,
  message text not null,
  student_number text,
  created_at timestamptz not null default now()
);

alter table public.event_feedback enable row level security;

drop policy if exists "anon read feedback" on public.event_feedback;
create policy "anon read feedback"
  on public.event_feedback for select using (true);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  posted_by text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists "anon read announcements" on public.announcements;
create policy "anon read announcements"
  on public.announcements for select using (true);

alter table public.event_feedback add column if not exists rating smallint check (rating is null or (rating >= 1 and rating <= 5));

alter table public.announcements add column if not exists audience text not null default 'all';
alter table public.announcements add column if not exists house_id text;
alter table public.announcements add column if not exists expires_at timestamptz;

create table if not exists public.staff_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  staff_id text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb
);

alter table public.staff_audit enable row level security;

create table if not exists public.game_saves (
  student_number text not null references public.students (student_number) on delete cascade,
  game_id text not null,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (student_number, game_id)
);

alter table public.game_saves enable row level security;


