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

-- Writes go through Vercel APIs with the service role (bypasses RLS).
-- The published anon key must not read student names, stamp cards, or feedback.
drop policy if exists "anon read students" on public.students;
drop policy if exists "anon insert students" on public.students;
drop policy if exists "anon insert cards" on public.stamp_cards;
drop policy if exists "anon update cards" on public.stamp_cards;
drop policy if exists "anon read cards" on public.stamp_cards;

create table if not exists public.game_scores (
  student_number text not null references public.students (student_number) on delete cascade,
  game_id text not null check (game_id in ('clicker', 'memory', 'catch')),
  score integer not null default 0 check (score >= 0),
  updated_at timestamptz not null default now(),
  primary key (student_number, game_id)
);

alter table public.game_scores enable row level security;

drop policy if exists "anon read scores" on public.game_scores;
drop policy if exists "anon insert scores" on public.game_scores;
drop policy if exists "anon update scores" on public.game_scores;

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
drop policy if exists "anon insert feedback" on public.event_feedback;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  posted_by text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.announcements enable row level security;

drop policy if exists "anon insert announcements" on public.announcements;
drop policy if exists "anon update announcements" on public.announcements;
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

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  student_number text not null references public.students (student_number) on delete cascade,
  p256dh text not null,
  auth text not null,
  watch jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create or replace function public.register_scream_student(p_number text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  nm text;
  existing public.students%rowtype;
begin
  n := upper(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if n ~ '^[0-9]{7}$' then
    n := 'P' || n;
  end if;
  if n !~ '^P[0-9]{7}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  nm := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  if char_length(nm) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;

  select * into existing from public.students where student_number = n;
  if found then
    if lower(regexp_replace(existing.full_name, '\s+', '', 'g')) <> lower(regexp_replace(nm, '\s+', '', 'g')) then
      return jsonb_build_object('ok', false, 'error', 'name_mismatch');
    end if;
    insert into public.stamp_cards (student_number, stamps)
    values (n, '{}'::jsonb)
    on conflict (student_number) do nothing;
    return jsonb_build_object('ok', true, 'created', false, 'student_number', n, 'full_name', existing.full_name);
  end if;

  insert into public.students (student_number, full_name) values (n, nm);
  insert into public.stamp_cards (student_number, stamps)
  values (n, '{}'::jsonb)
  on conflict (student_number) do nothing;
  return jsonb_build_object('ok', true, 'created', true, 'student_number', n, 'full_name', nm);
end;
$$;

create or replace function public.get_scream_card(p_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  card public.stamp_cards%rowtype;
begin
  n := upper(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if n ~ '^[0-9]{7}$' then
    n := 'P' || n;
  end if;
  select * into card from public.stamp_cards where student_number = n;
  if not found then
    insert into public.stamp_cards (student_number, stamps)
    values (n, '{}'::jsonb)
    on conflict (student_number) do nothing;
    select * into card from public.stamp_cards where student_number = n;
  end if;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'stamps', coalesce(card.stamps, '{}'::jsonb),
    'redeemed_at', card.redeemed_at,
    'redeemed_by', card.redeemed_by
  );
end;
$$;

revoke all on function public.register_scream_student(text, text) from public;
revoke all on function public.get_scream_card(text) from public;
grant execute on function public.register_scream_student(text, text) to anon, authenticated, service_role;
grant execute on function public.get_scream_card(text) to anon, authenticated, service_role;

create or replace function public.set_scare_house_wait(p_id text, p_wait integer, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.scare_houses%rowtype;
  wait_val integer;
begin
  if p_id is null or length(trim(p_id)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;
  if p_status not in ('open', 'busy', 'closed', 'at_capacity') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  wait_val := greatest(0, least(240, coalesce(p_wait, 0)));

  update public.scare_houses
    set wait_minutes = wait_val,
        status = p_status,
        updated_at = now()
  where id = p_id
  returning * into row;

  if not found then
    insert into public.scare_houses (id, name, wait_minutes, status)
    values (p_id, p_id, wait_val, p_status)
    returning * into row;
  end if;

  return jsonb_build_object('ok', true, 'house', to_jsonb(row));
end;
$$;

revoke all on function public.set_scare_house_wait(text, integer, text) from public;
grant execute on function public.set_scare_house_wait(text, integer, text) to anon, authenticated, service_role;

alter table public.push_subscriptions alter column student_number drop not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_student_number_fkey;

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_student text,
  p_p256dh text,
  p_auth text,
  p_watch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_endpoint is null or length(p_endpoint) < 12 or length(p_endpoint) > 2048 then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.push_subscriptions (endpoint, student_number, p256dh, auth, watch, updated_at)
  values (
    p_endpoint,
    nullif(trim(coalesce(p_student, '')), ''),
    coalesce(p_p256dh, ''),
    coalesce(p_auth, ''),
    coalesce(p_watch, '[]'::jsonb),
    now()
  )
  on conflict (endpoint) do update set
    student_number = coalesce(excluded.student_number, public.push_subscriptions.student_number),
    p256dh = case when length(excluded.p256dh) > 0 then excluded.p256dh else public.push_subscriptions.p256dh end,
    auth = case when length(excluded.auth) > 0 then excluded.auth else public.push_subscriptions.auth end,
    watch = excluded.watch,
    updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.list_push_watchers(p_house text)
returns table (endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public
as $$
  select s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.watch @> to_jsonb(array[p_house]);
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.upsert_push_subscription(text, text, text, text, jsonb) from public;
revoke all on function public.list_push_watchers(text) from public;
revoke all on function public.delete_push_subscription(text) from public;
grant execute on function public.upsert_push_subscription(text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.list_push_watchers(text) to anon, authenticated, service_role;
grant execute on function public.delete_push_subscription(text) to anon, authenticated, service_role;



