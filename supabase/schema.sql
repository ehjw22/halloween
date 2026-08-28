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
create policy "public upsert scare houses"
  on public.scare_houses for insert
  with check (true);

drop policy if exists "public update scare houses" on public.scare_houses;
create policy "public update scare houses"
  on public.scare_houses for update
  using (true)
  with check (true);

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
create policy "anon insert students"
  on public.students for insert with check (true);

drop policy if exists "anon read cards" on public.stamp_cards;
create policy "anon read cards"
  on public.stamp_cards for select using (true);
drop policy if exists "anon insert cards" on public.stamp_cards;
create policy "anon insert cards"
  on public.stamp_cards for insert with check (true);
drop policy if exists "anon update cards" on public.stamp_cards;
create policy "anon update cards"
  on public.stamp_cards for update using (true) with check (true);

alter table public.scare_houses replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.scare_houses;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
