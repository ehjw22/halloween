-- Halloween wait-time board + student stamp cards
-- Run in the Supabase SQL editor, then enable Realtime for scare_houses.

create table if not exists public.scare_houses (
  id text primary key,
  name text not null,
  wait_minutes integer not null default 0 check (wait_minutes >= 0),
  status text not null default 'open'
    check (status in ('gonow', 'open', 'busy', 'long', 'closed')),
  updated_at timestamptz not null default now()
);

-- Existing databases keep the old check until this runs. create table if not exists does not alter it.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'scare_houses'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.scare_houses drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.scare_houses
  drop constraint if exists scare_houses_status_check;

alter table public.scare_houses
  add constraint scare_houses_status_check
  check (status in ('gonow', 'open', 'busy', 'long', 'closed'));

-- Stored status follows the minutes already on the row. Wait times are left as they are.
update public.scare_houses
set status = case
  when wait_minutes >= 60 then 'closed'
  when wait_minutes >= 40 then 'long'
  when wait_minutes >= 21 then 'busy'
  when wait_minutes >= 6 then 'open'
  else 'gonow'
end
where status is distinct from (
  case
    when wait_minutes >= 60 then 'closed'
    when wait_minutes >= 40 then 'long'
    when wait_minutes >= 21 then 'busy'
    when wait_minutes >= 6 then 'open'
    else 'gonow'
  end
);

alter table public.scare_houses enable row level security;

drop policy if exists "public read scare houses" on public.scare_houses;
create policy "public read scare houses"
  on public.scare_houses for select
  using (true);

drop policy if exists "public upsert scare houses" on public.scare_houses;
drop policy if exists "public update scare houses" on public.scare_houses;

insert into public.scare_houses (id, name, wait_minutes, status) values
  ('three-doors', 'The Three Doors', 8, 'open'),
  ('marionette', 'The Marionette''s Lullaby', 12, 'open'),
  ('caligari', 'Cold Case: The Caligari Circus', 18, 'open'),
  ('clowns', 'The Clowns That Never Died', 22, 'busy'),
  ('illusionist', 'The Illusionist: After The Curtain Falls', 15, 'open'),
  ('last-laugh', 'The Last Laugh: Clown Alley', 6, 'open'),
  ('cursed-cavern', 'The Cursed Cavern', 25, 'busy'),
  ('no-one-leaves', 'No One Leaves', 10, 'open'),
  ('prisoner', 'Prisoner of Spirits', 32, 'busy'),
  ('whispering-woods', 'Whispering Woods', 14, 'open'),
  ('slenderman', 'Slenderman''s Lair', 28, 'busy'),
  ('he-who-watches', 'He Who Watches', 9, 'open'),
  ('abandoned-asylum', 'Abandoned Asylum', 35, 'busy'),
  ('forever-patients', 'Forever Patients: Dover''s Madness', 16, 'open'),
  ('living-dead', 'Hall of the Living Dead', 20, 'open')
on conflict (id) do update
  set name = excluded.name;

create table if not exists public.students (
  student_number text primary key,
  full_name text not null,
  created_at timestamptz not null default now()
);

alter table public.students add column if not exists role text not null default 'student';
alter table public.students drop constraint if exists students_role_check;
alter table public.students add constraint students_role_check
  check (role in ('student', 'admin', 'stamps', 'waits'));

-- Grant staff tools (then they still type ADMIN_PASSCODE on sign-in):
-- update public.students set role = 'admin' where student_number = 'P1234567';
-- Booth-only: role = 'stamps'. Wait-times only: role = 'waits'.

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
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'student_number', n,
      'full_name', existing.full_name,
      'role', coalesce(existing.role, 'student')
    );
  end if;

  insert into public.students (student_number, full_name) values (n, nm);
  insert into public.stamp_cards (student_number, stamps)
  values (n, '{}'::jsonb)
  on conflict (student_number) do nothing;
  return jsonb_build_object('ok', true, 'created', true, 'student_number', n, 'full_name', nm, 'role', 'student');
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
revoke all on function public.register_scream_student(text, text) from anon, authenticated;
revoke all on function public.get_scream_card(text) from anon, authenticated;
grant execute on function public.register_scream_student(text, text) to service_role;
grant execute on function public.get_scream_card(text) to service_role;

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
  wait_val := greatest(0, least(240, coalesce(p_wait, 0)));
  if wait_val >= 60 then
    p_status := 'closed';
  elsif wait_val >= 40 then
    p_status := 'long';
  elsif wait_val >= 21 then
    p_status := 'busy';
  elsif wait_val >= 6 then
    p_status := 'open';
  else
    p_status := 'gonow';
  end if;

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
revoke all on function public.set_scare_house_wait(text, integer, text) from anon, authenticated;
grant execute on function public.set_scare_house_wait(text, integer, text) to service_role;

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
revoke all on function public.upsert_push_subscription(text, text, text, text, jsonb) from anon, authenticated;
revoke all on function public.list_push_watchers(text) from anon, authenticated;
revoke all on function public.delete_push_subscription(text) from anon, authenticated;
grant execute on function public.upsert_push_subscription(text, text, text, text, jsonb) to service_role;
grant execute on function public.list_push_watchers(text) to service_role;
grant execute on function public.delete_push_subscription(text) to service_role;

create or replace function public.award_scream_stamp(p_number text, p_booth text, p_staff text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  booth text;
  student public.students%rowtype;
  card public.stamp_cards%rowtype;
  next_stamps jsonb;
begin
  n := upper(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if n ~ '^[0-9]{7}$' then
    n := 'P' || n;
  end if;
  if n !~ '^P[0-9]{7}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  booth := regexp_replace(coalesce(p_booth, ''), '[^0-9]', '', 'g');
  if booth !~ '^(1|2|4|5|6|7|8|9)$' then
    return jsonb_build_object('ok', false, 'error', 'bad_booth');
  end if;

  select * into student from public.students
  where upper(regexp_replace(student_number, '[^A-Za-z0-9]', '', 'g')) = n
     or upper(regexp_replace(student_number, '[^A-Za-z0-9]', '', 'g')) = substring(n from 2)
     or ('P' || upper(regexp_replace(student_number, '[^A-Za-z0-9]', '', 'g'))) = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;

  n := student.student_number;

  select * into card from public.stamp_cards where student_number = n;
  if not found then
    insert into public.stamp_cards (student_number, stamps)
    values (n, '{}'::jsonb)
    on conflict (student_number) do nothing;
    select * into card from public.stamp_cards where student_number = n;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_card');
  end if;

  next_stamps := coalesce(card.stamps, '{}'::jsonb);
  if next_stamps ? booth then
    return jsonb_build_object('ok', false, 'error', 'already', 'full_name', student.full_name, 'student_number', n, 'stamps', next_stamps);
  end if;

  next_stamps := next_stamps || jsonb_build_object(
    booth,
    jsonb_build_object(
      'by', left(trim(coalesce(p_staff, 'staff')), 80),
      'at', (extract(epoch from now()) * 1000)::bigint,
      'boothId', booth
    )
  );

  update public.stamp_cards
    set stamps = next_stamps,
        updated_at = now()
  where student_number = n
  returning * into card;

  return jsonb_build_object(
    'ok', true,
    'student_number', n,
    'full_name', student.full_name,
    'stamps', card.stamps
  );
end;
$$;

revoke all on function public.award_scream_stamp(text, text, text) from public;
revoke all on function public.award_scream_stamp(text, text, text) from anon, authenticated;
grant execute on function public.award_scream_stamp(text, text, text) to service_role;

create or replace function public.lookup_scream_student(p_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  student public.students%rowtype;
  card public.stamp_cards%rowtype;
begin
  n := upper(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if n ~ '^[0-9]{7}$' then
    n := 'P' || n;
  end if;
  if n !~ '^P[0-9]{7}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;

  select * into student from public.students
  where upper(regexp_replace(student_number, '[^A-Za-z0-9]', '', 'g')) = n
     or upper(regexp_replace(student_number, '[^A-Za-z0-9]', '', 'g')) = substring(n from 2)
     or ('P' || upper(regexp_replace(student_number, '[^A-Za-z0-9]', '', 'g'))) = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;

  select * into card from public.stamp_cards where student_number = student.student_number;
  return jsonb_build_object(
    'ok', true,
    'student_number', student.student_number,
    'full_name', student.full_name,
    'role', coalesce(student.role, 'student'),
    'stamps', coalesce(card.stamps, '{}'::jsonb),
    'redeemed_at', card.redeemed_at,
    'redeemed_by', card.redeemed_by
  );
end;
$$;

revoke all on function public.lookup_scream_student(text) from public;
revoke all on function public.lookup_scream_student(text) from anon, authenticated;
grant execute on function public.lookup_scream_student(text) to service_role;

-- Public clients may only read live house waits and active announcement copy.
-- Student names, stamps, feedback, and staff audit stay on the service role.
drop policy if exists "anon read live announcements" on public.announcements;
create policy "anon read live announcements"
  on public.announcements for select
  using (active = true and (expires_at is null or expires_at > now()));

revoke all on table public.announcements from anon, authenticated, public;
grant select (id, message, created_at, audience, house_id, expires_at, active)
  on table public.announcements to anon, authenticated;

revoke all on table public.students from anon, authenticated, public;
revoke all on table public.stamp_cards from anon, authenticated, public;
revoke all on table public.event_feedback from anon, authenticated, public;
revoke all on table public.staff_audit from anon, authenticated, public;
revoke all on table public.game_saves from anon, authenticated, public;
revoke all on table public.game_scores from anon, authenticated, public;
revoke all on table public.push_subscriptions from anon, authenticated, public;
grant select on table public.scare_houses to anon, authenticated;





