-- Halloween wait-time board for Singapore Polytechnic
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

-- Optional realtime (ignore error if already added):
-- alter publication supabase_realtime add table public.scare_houses;
