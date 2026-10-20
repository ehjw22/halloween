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

-- Grant staff tools (they still type a staff password on sign-in):
-- update public.students set role = 'admin' where student_number = 'P2512345';
-- Booth passwords: role = 'stamps'. All-house waits, or one house password: role = 'waits'.
-- The password, not this role, chooses the scope (admin, waits, redeem, booth:id, house:id).

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
  kind text not null check (kind in ('general', 'scare_house', 'booth')),
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

alter table public.event_feedback drop constraint if exists event_feedback_kind_check;
alter table public.event_feedback
  add constraint event_feedback_kind_check
  check (kind in ('general', 'scare_house', 'booth'));

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
  if n !~ '^P(22|23|24|25|26)[0-9]{5}$' then
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
  if n !~ '^P(22|23|24|25|26)[0-9]{5}$' then
    return jsonb_build_object('ok', false);
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
  if n !~ '^P(22|23|24|25|26)[0-9]{5}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  booth := regexp_replace(coalesce(p_booth, ''), '[^0-9]', '', 'g');
  if booth !~ '^(1|2|4|7|8)$' then
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
  if n !~ '^P(22|23|24|25|26)[0-9]{5}$' then
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

-- Admin numbers are stored uppercase. The sign-in form accepts ^[Pp](22|23|24|25|26)\d{5}$
-- (a P, cohort 22-26, then 5 digits, as in P2509460) and uppercases it before save.
-- The check below is the stored form: ^P(22|23|24|25|26)[0-9]{5}$
-- Run the ADD CONSTRAINT statements below first. They are NOT VALID, so existing rows
-- stay in place and new inserts are checked. VALIDATE is a later step and fails with
-- SQLSTATE 42704 if the ADD has not been run.
-- After the audit query returns no rows for a table, validate that table only:
--   alter table public.students validate constraint students_number_format;
--   alter table public.stamp_cards validate constraint stamp_cards_number_format;
--   alter table public.stamp_cards validate constraint stamp_cards_redeemed_by_format;
--   alter table public.game_scores validate constraint game_scores_number_format;
--   alter table public.game_saves validate constraint game_saves_number_format;
--   alter table public.event_feedback validate constraint event_feedback_number_format;
--   alter table public.push_subscriptions validate constraint push_subscriptions_number_format;
-- Leave staff_audit NOT VALID while any staff_id is still outside the pattern
-- (early testing wrote P1234567). New audit rows are still rejected if they do not match.
--   alter table public.staff_audit validate constraint staff_audit_staff_id_format;
--
-- Audit (run before VALIDATE):
-- select 'students' as src, student_number as value from public.students
--   where student_number !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'stamp_cards', student_number from public.stamp_cards
--   where student_number !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'stamp_cards.redeemed_by', redeemed_by from public.stamp_cards
--   where redeemed_by is not null and redeemed_by !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'game_scores', student_number from public.game_scores
--   where student_number !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'game_saves', student_number from public.game_saves
--   where student_number !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'event_feedback', student_number from public.event_feedback
--   where student_number is not null and student_number !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'push_subscriptions', student_number from public.push_subscriptions
--   where student_number is not null and student_number !~ '^P(22|23|24|25|26)[0-9]{5}$'
-- union all
-- select 'staff_audit', staff_id from public.staff_audit
--   where staff_id !~ '^P(22|23|24|25|26)[0-9]{5}$';

alter table public.students drop constraint if exists students_number_format;
alter table public.students
  add constraint students_number_format
  check (student_number ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.stamp_cards drop constraint if exists stamp_cards_number_format;
alter table public.stamp_cards
  add constraint stamp_cards_number_format
  check (student_number ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.stamp_cards drop constraint if exists stamp_cards_redeemed_by_format;
alter table public.stamp_cards
  add constraint stamp_cards_redeemed_by_format
  check (redeemed_by is null or redeemed_by ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.game_scores drop constraint if exists game_scores_number_format;
alter table public.game_scores
  add constraint game_scores_number_format
  check (student_number ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.game_saves drop constraint if exists game_saves_number_format;
alter table public.game_saves
  add constraint game_saves_number_format
  check (student_number ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.event_feedback drop constraint if exists event_feedback_number_format;
alter table public.event_feedback
  add constraint event_feedback_number_format
  check (student_number is null or student_number ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.push_subscriptions drop constraint if exists push_subscriptions_number_format;
alter table public.push_subscriptions
  add constraint push_subscriptions_number_format
  check (student_number is null or student_number ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

alter table public.staff_audit drop constraint if exists staff_audit_staff_id_format;
alter table public.staff_audit
  add constraint staff_audit_staff_id_format
  check (staff_id ~ '^P(22|23|24|25|26)[0-9]{5}$') not valid;

-- ---------------------------------------------------------------------------
-- Service-role functions. Idempotent. Sign-in is admin number + full name.
-- There is no student PIN. Wait status follows the minutes (60 or more is closed).
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.scream_norm_number(p_number text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  n text;
begin
  n := upper(regexp_replace(coalesce(p_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if n ~ '^[0-9]{7}$' then
    n := 'P' || n;
  end if;
  if n !~ '^P(22|23|24|25|26)[0-9]{5}$' then
    return null;
  end if;
  return n;
end;
$$;

create or replace function public.scream_fold_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(lower(coalesce(p_name, '')), '[[:space:][:punct:]]+', '', 'g');
$$;

-- p_closed is accepted and ignored so older callers keep working.
create or replace function public.scream_wait_status(p_wait integer, p_closed boolean default false)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_wait, 0) >= 60 then 'closed'
    when coalesce(p_wait, 0) >= 40 then 'long'
    when coalesce(p_wait, 0) >= 21 then 'busy'
    when coalesce(p_wait, 0) >= 6 then 'open'
    else 'gonow'
  end;
$$;

create or replace function public.scream_stamp_booths()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['1', '2', '8', '4', '7']::text[];
$$;

create or replace function public.scream_set_wait(
  p_id text,
  p_wait integer,
  p_closed boolean default null,
  p_staff text default '',
  p_scope text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prev public.scare_houses%rowtype;
  saved public.scare_houses%rowtype;
  wait_val integer;
begin
  if p_id is null or p_id !~ '^[a-z0-9-]{2,40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;
  select * into prev from public.scare_houses where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_house');
  end if;
  wait_val := greatest(0, least(240, coalesce(p_wait, prev.wait_minutes, 0)));
  update public.scare_houses
    set wait_minutes = wait_val,
        status = public.scream_wait_status(wait_val, false),
        updated_at = now()
  where id = p_id
  returning * into saved;
  if prev.wait_minutes is distinct from wait_val then
    insert into public.staff_audit (staff_id, action, target, detail)
    values (
      left(coalesce(p_staff, ''), 16),
      'wait_update',
      p_id,
      jsonb_build_object(
        'wait_minutes', wait_val,
        'previous_wait', prev.wait_minutes,
        'scope', left(coalesce(p_scope, ''), 40)
      )
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'house', to_jsonb(saved),
    'previous_wait', prev.wait_minutes
  );
end;
$$;

drop function if exists public.scream_student_sign_in(text, text, text, integer, integer);
drop function if exists public.scream_reset_pin(text, text);

alter table public.students drop column if exists pin_hash;
alter table public.students drop column if exists pin_set_at;
alter table public.students drop column if exists pin_failures;
alter table public.students drop column if exists pin_locked_until;

alter table public.scare_houses drop column if exists closed;

create or replace function public.scream_student_sign_in(p_number text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  nm text;
  s public.students%rowtype;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  nm := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  if char_length(nm) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  select * into s from public.students where student_number = n for update;
  if not found then
    insert into public.students (student_number, full_name)
    values (n, nm);
    insert into public.stamp_cards (student_number, stamps)
    values (n, '{}'::jsonb)
    on conflict (student_number) do nothing;
    return jsonb_build_object('ok', true, 'created', true, 'student_number', n, 'full_name', nm, 'role', 'student');
  end if;
  if public.scream_fold_name(s.full_name) is distinct from public.scream_fold_name(nm) then
    return jsonb_build_object('ok', false, 'error', 'name_mismatch');
  end if;
  insert into public.stamp_cards (student_number, stamps)
  values (n, '{}'::jsonb)
  on conflict (student_number) do nothing;
  return jsonb_build_object(
    'ok', true,
    'created', false,
    'student_number', n,
    'full_name', s.full_name,
    'role', coalesce(s.role, 'student')
  );
end;
$$;

-- Stamp card reads
-- ---------------------------------------------------------------------------

create or replace function public.scream_lookup_student(p_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  s public.students%rowtype;
  c public.stamp_cards%rowtype;
  stamp_count integer;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  select * into s from public.students where student_number = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  insert into public.stamp_cards (student_number, stamps)
  values (n, '{}'::jsonb)
  on conflict (student_number) do nothing;
  select * into c from public.stamp_cards where student_number = n;
  select count(*) into stamp_count
  from jsonb_object_keys(coalesce(c.stamps, '{}'::jsonb)) k
  where k = any (public.scream_stamp_booths());
  return jsonb_build_object(
    'ok', true,
    'student_number', s.student_number,
    'full_name', s.full_name,
    'role', coalesce(s.role, 'student'),
    'stamps', coalesce(c.stamps, '{}'::jsonb),
    'stamp_count', stamp_count,
    'redeemed_at', c.redeemed_at,
    'redeemed_by', c.redeemed_by,
    'updated_at', c.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Stamps and wheel ticket: atomic, idempotent, and logged in the same transaction
-- ---------------------------------------------------------------------------

create or replace function public.scream_award_stamp(p_number text, p_booth text, p_staff text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  booth text;
  s public.students%rowtype;
  c public.stamp_cards%rowtype;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  booth := regexp_replace(coalesce(p_booth, ''), '[^0-9]', '', 'g');
  if not (booth = any (public.scream_stamp_booths())) then
    return jsonb_build_object('ok', false, 'error', 'bad_booth');
  end if;
  select * into s from public.students where student_number = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  insert into public.stamp_cards (student_number, stamps)
  values (n, '{}'::jsonb)
  on conflict (student_number) do nothing;
  select * into c from public.stamp_cards where student_number = n for update;
  if coalesce(c.stamps, '{}'::jsonb) ? booth then
    return jsonb_build_object(
      'ok', true, 'already', true,
      'student_number', n, 'full_name', s.full_name, 'stamps', c.stamps
    );
  end if;
  update public.stamp_cards
    set stamps = coalesce(stamps, '{}'::jsonb) || jsonb_build_object(
          booth,
          jsonb_build_object(
            'by', left(coalesce(p_staff, 'staff'), 16),
            'at', (extract(epoch from clock_timestamp()) * 1000)::bigint,
            'boothId', booth
          )
        ),
        updated_at = now()
  where student_number = n
  returning * into c;
  insert into public.staff_audit (staff_id, action, target, detail)
  values (left(coalesce(p_staff, ''), 16), 'award_stamp', n, jsonb_build_object('boothId', booth));
  return jsonb_build_object(
    'ok', true, 'already', false,
    'student_number', n, 'full_name', s.full_name, 'stamps', c.stamps
  );
end;
$$;

create or replace function public.scream_unaward_stamp(
  p_number text,
  p_booth text,
  p_staff text,
  p_window_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  booth text;
  s public.students%rowtype;
  c public.stamp_cards%rowtype;
  at_ms bigint;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  booth := regexp_replace(coalesce(p_booth, ''), '[^0-9]', '', 'g');
  if not (booth = any (public.scream_stamp_booths())) then
    return jsonb_build_object('ok', false, 'error', 'bad_booth');
  end if;
  select * into s from public.students where student_number = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  select * into c from public.stamp_cards where student_number = n for update;
  if not found or not (coalesce(c.stamps, '{}'::jsonb) ? booth) then
    return jsonb_build_object('ok', false, 'error', 'not_stamped');
  end if;
  if c.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'redeemed');
  end if;
  at_ms := nullif(c.stamps -> booth ->> 'at', '')::bigint;
  if at_ms is null or (extract(epoch from clock_timestamp()) * 1000)::bigint - at_ms > greatest(1, p_window_seconds) * 1000 then
    return jsonb_build_object('ok', false, 'error', 'window_closed');
  end if;
  update public.stamp_cards
    set stamps = stamps - booth, updated_at = now()
  where student_number = n
  returning * into c;
  insert into public.staff_audit (staff_id, action, target, detail)
  values (left(coalesce(p_staff, ''), 16), 'unaward_stamp', n, jsonb_build_object('boothId', booth));
  return jsonb_build_object('ok', true, 'student_number', n, 'full_name', s.full_name, 'stamps', c.stamps);
end;
$$;

create or replace function public.scream_redeem_pass(p_number text, p_staff text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  s public.students%rowtype;
  c public.stamp_cards%rowtype;
  filled integer;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  select * into s from public.students where student_number = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  select * into c from public.stamp_cards where student_number = n for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'needs_stamps', 'stamp_count', 0);
  end if;
  select count(*) into filled
  from jsonb_object_keys(coalesce(c.stamps, '{}'::jsonb)) k
  where k = any (public.scream_stamp_booths());
  if c.redeemed_at is not null then
    return jsonb_build_object(
      'ok', true, 'already', true, 'student_number', n, 'full_name', s.full_name,
      'redeemed_at', c.redeemed_at, 'redeemed_by', c.redeemed_by, 'stamp_count', filled
    );
  end if;
  if filled < cardinality(public.scream_stamp_booths()) then
    return jsonb_build_object('ok', false, 'error', 'needs_stamps', 'stamp_count', filled);
  end if;
  update public.stamp_cards
    set redeemed_at = now(), redeemed_by = left(coalesce(p_staff, ''), 16), updated_at = now()
  where student_number = n
  returning * into c;
  insert into public.staff_audit (staff_id, action, target, detail)
  values (left(coalesce(p_staff, ''), 16), 'redeem_pass', n, jsonb_build_object('passId', 'SP-FP-' || n));
  return jsonb_build_object(
    'ok', true, 'already', false, 'student_number', n, 'full_name', s.full_name,
    'redeemed_at', c.redeemed_at, 'redeemed_by', c.redeemed_by, 'stamp_count', filled
  );
end;
$$;

create or replace function public.scream_unredeem_pass(
  p_number text,
  p_staff text,
  p_window_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  s public.students%rowtype;
  c public.stamp_cards%rowtype;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  select * into s from public.students where student_number = n;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_student');
  end if;
  select * into c from public.stamp_cards where student_number = n for update;
  if not found or c.redeemed_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_redeemed');
  end if;
  if now() - c.redeemed_at > make_interval(secs => greatest(1, p_window_seconds)) then
    return jsonb_build_object('ok', false, 'error', 'window_closed');
  end if;
  update public.stamp_cards
    set redeemed_at = null, redeemed_by = null, updated_at = now()
  where student_number = n
  returning * into c;
  insert into public.staff_audit (staff_id, action, target, detail)
  values (left(coalesce(p_staff, ''), 16), 'unredeem_pass', n, jsonb_build_object('passId', 'SP-FP-' || n));
  return jsonb_build_object('ok', true, 'student_number', n, 'full_name', s.full_name, 'redeemed_at', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Command post counts, computed in SQL so they are not capped by REST row limits
-- ---------------------------------------------------------------------------

create or replace function public.scream_ops_summary(p_audit_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  per_booth jsonb;
begin
  select coalesce(jsonb_object_agg(b, (select count(*) from public.stamp_cards c where coalesce(c.stamps, '{}'::jsonb) ? b)), '{}'::jsonb)
  into per_booth
  from unnest(public.scream_stamp_booths()) as b;
  return jsonb_build_object(
    'students', (select count(*) from public.students),
    'stamps_per_booth', per_booth,
    'fast_pass_unlocked', (select count(*) from public.stamp_cards c where coalesce(c.stamps, '{}'::jsonb) ?& public.scream_stamp_booths()),
    'redeemed', (select count(*) from public.stamp_cards c where c.redeemed_at is not null),
    'houses_busy', (select count(*) from public.scare_houses h where h.status = 'busy'),
    'houses_long', (select count(*) from public.scare_houses h where h.status = 'long'),
    'houses_closed', (select count(*) from public.scare_houses h where h.status = 'closed'),
    'recent_feedback', (select count(*) from public.event_feedback f where f.created_at > now() - interval '6 hours'),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.at desc)
      from (
        select id, at, staff_id, action, target, detail
        from public.staff_audit
        order by at desc
        limit greatest(1, least(100, p_audit_limit))
      ) a
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limits shared across every serverless instance
-- ---------------------------------------------------------------------------

create table if not exists public.scream_rate_limits (
  bucket text primary key,
  hits integer not null default 0,
  window_start timestamptz not null default now()
);

alter table public.scream_rate_limits enable row level security;
revoke all on table public.scream_rate_limits from anon, authenticated, public;

create or replace function public.scream_rate_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.scream_rate_limits%rowtype;
  win interval := make_interval(secs => greatest(1, p_window_seconds));
begin
  if p_bucket is null or length(p_bucket) < 3 or length(p_bucket) > 200 then
    return jsonb_build_object('ok', false, 'retry_after', 60);
  end if;
  insert into public.scream_rate_limits as t (bucket, hits, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update set
    hits = case when t.window_start < now() - win then 1 else t.hits + 1 end,
    window_start = case when t.window_start < now() - win then now() else t.window_start end
  returning * into r;
  if random() < 0.01 then
    delete from public.scream_rate_limits where window_start < now() - interval '1 day';
  end if;
  return jsonb_build_object(
    'ok', r.hits <= greatest(1, p_max),
    'hits', r.hits,
    'retry_after', greatest(0, ceil(extract(epoch from (r.window_start + win - now())))::int)
  );
end;
$$;

create or replace function public.scream_rate_peek(p_bucket text, p_max integer, p_window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.scream_rate_limits%rowtype;
  win interval := make_interval(secs => greatest(1, p_window_seconds));
begin
  select * into r from public.scream_rate_limits where bucket = p_bucket;
  if not found or r.window_start < now() - win then
    return jsonb_build_object('ok', true, 'hits', 0, 'retry_after', 0);
  end if;
  return jsonb_build_object(
    'ok', r.hits < greatest(1, p_max),
    'hits', r.hits,
    'retry_after', greatest(0, ceil(extract(epoch from (r.window_start + win - now())))::int)
  );
end;
$$;

create or replace function public.scream_rate_reset(p_bucket text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.scream_rate_limits where bucket = p_bucket;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: nothing new is reachable with the public anon key
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.scream_norm_number(text)',
    'public.scream_fold_name(text)',
    'public.scream_wait_status(integer, boolean)',
    'public.scream_stamp_booths()',
    'public.scream_set_wait(text, integer, boolean, text, text)',
    'public.scream_student_sign_in(text, text)',
    'public.scream_lookup_student(text)',
    'public.scream_award_stamp(text, text, text)',
    'public.scream_unaward_stamp(text, text, text, integer)',
    'public.scream_redeem_pass(text, text)',
    'public.scream_unredeem_pass(text, text, integer)',
    'public.scream_ops_summary(integer)',
    'public.scream_rate_hit(text, integer, integer)',
    'public.scream_rate_peek(text, integer, integer)',
    'public.scream_rate_reset(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- The older helper RPCs stay service-role only as well (re-asserted in case they were re-created).
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.register_scream_student(text, text)',
    'public.get_scream_card(text)',
    'public.set_scare_house_wait(text, integer, text)',
    'public.award_scream_stamp(text, text, text)',
    'public.lookup_scream_student(text)',
    'public.upsert_push_subscription(text, text, text, text, jsonb)',
    'public.list_push_watchers(text)',
    'public.delete_push_subscription(text)'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

revoke all on table public.students from anon, authenticated, public;
revoke all on table public.stamp_cards from anon, authenticated, public;
revoke all on table public.event_feedback from anon, authenticated, public;
revoke all on table public.staff_audit from anon, authenticated, public;
revoke all on table public.game_saves from anon, authenticated, public;
revoke all on table public.game_scores from anon, authenticated, public;
revoke all on table public.push_subscriptions from anon, authenticated, public;

-- ===========================================================================
-- scale-3000 section (same statements as supabase/scale-3000.sql, for fresh setups)
-- ===========================================================================

-- SP Scream Fest: scale-up for ~3000 phones on one night.
-- Safe to re-run (IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS).
-- Run the whole file once in the Supabase SQL editor of the EXISTING project, after schema.sql.
-- (The same statements are appended to the end of schema.sql for fresh setups.)
--
-- What it adds
--   1. updated_at on announcements + touch triggers, so one cheap max(updated_at) is a version.
--   2. scream_versions(): the tiny payload behind /api?path=versions.
--   3. Indexes for the version queries, the public announcement list and rate-limit cleanup.
--   4. scream_student_sign_in: conflict-safe insert (two phones signing up the same number at once).
--   5. scream_set_wait: optional p_expected_updated_at ("someone else just changed this").
--   6. scream_save_score: best score is one atomic upsert (no read-then-write).
--   7. scream_add_feedback: drops an identical note sent twice within a minute.

-- ---------------------------------------------------------------------------
-- 1. Version columns and triggers
-- ---------------------------------------------------------------------------

alter table public.announcements add column if not exists updated_at timestamptz not null default now();

create or replace function public.scream_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists announcements_touch_updated_at on public.announcements;
create trigger announcements_touch_updated_at
  before update on public.announcements
  for each row execute function public.scream_touch_updated_at();

-- A wait time edited by hand in the Supabase table editor must also move the version.
drop trigger if exists scare_houses_touch_updated_at on public.scare_houses;
create trigger scare_houses_touch_updated_at
  before update on public.scare_houses
  for each row execute function public.scream_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

create index if not exists scare_houses_updated_at_idx on public.scare_houses (updated_at desc);
create index if not exists announcements_updated_at_idx on public.announcements (updated_at desc);
create index if not exists announcements_active_created_idx on public.announcements (created_at desc) where active;
create index if not exists scream_rate_limits_window_idx on public.scream_rate_limits (window_start);
create index if not exists event_feedback_created_idx on public.event_feedback (created_at desc);
create index if not exists event_feedback_dedupe_idx on public.event_feedback (student_number, kind, target_id, created_at desc);
create index if not exists push_subscriptions_watch_idx on public.push_subscriptions using gin (watch);

-- ---------------------------------------------------------------------------
-- 3. Versions for the CDN-cached poll
-- ---------------------------------------------------------------------------

create or replace function public.scream_versions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'waits_v', coalesce((select floor(extract(epoch from max(updated_at)) * 1000)::bigint from public.scare_houses), 0),
    'announce_v', coalesce((select floor(extract(epoch from max(updated_at)) * 1000)::bigint from public.announcements), 0),
    'server_time', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Sign-up: unique student number, conflict-safe
-- ---------------------------------------------------------------------------

create or replace function public.scream_student_sign_in(p_number text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  nm text;
  s public.students%rowtype;
  inserted integer := 0;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  nm := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  if char_length(nm) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  -- The primary key decides who creates the row. A parallel sign-up of the same number
  -- inserts nothing and falls through to the name check below instead of failing.
  insert into public.students (student_number, full_name)
  values (n, nm)
  on conflict (student_number) do nothing;
  get diagnostics inserted = row_count;
  select * into s from public.students where student_number = n;
  insert into public.stamp_cards (student_number, stamps)
  values (n, '{}'::jsonb)
  on conflict (student_number) do nothing;
  if inserted = 1 then
    return jsonb_build_object('ok', true, 'created', true, 'student_number', n, 'full_name', nm, 'role', 'student');
  end if;
  if public.scream_fold_name(s.full_name) is distinct from public.scream_fold_name(nm) then
    return jsonb_build_object('ok', false, 'error', 'name_mismatch');
  end if;
  return jsonb_build_object(
    'ok', true,
    'created', false,
    'student_number', n,
    'full_name', s.full_name,
    'role', coalesce(s.role, 'student')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Wait times: optional optimistic check. Old 5-argument callers keep working.
-- ---------------------------------------------------------------------------

drop function if exists public.scream_set_wait(text, integer, boolean, text, text);

create or replace function public.scream_set_wait(
  p_id text,
  p_wait integer,
  p_closed boolean default null,
  p_staff text default '',
  p_scope text default '',
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prev public.scare_houses%rowtype;
  saved public.scare_houses%rowtype;
  wait_val integer;
begin
  if p_id is null or p_id !~ '^[a-z0-9-]{2,40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;
  select * into prev from public.scare_houses where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_house');
  end if;
  -- Staff A and B both saw 12 min; A saves 20, B then tries 5 from a stale screen.
  if p_expected_updated_at is not null and prev.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'house', to_jsonb(prev));
  end if;
  wait_val := greatest(0, least(240, coalesce(p_wait, prev.wait_minutes, 0)));
  update public.scare_houses
    set wait_minutes = wait_val,
        status = public.scream_wait_status(wait_val, false),
        updated_at = now()
  where id = p_id
  returning * into saved;
  if prev.wait_minutes is distinct from wait_val then
    insert into public.staff_audit (staff_id, action, target, detail)
    values (
      left(coalesce(p_staff, ''), 16),
      'wait_update',
      p_id,
      jsonb_build_object(
        'wait_minutes', wait_val,
        'previous_wait', prev.wait_minutes,
        'scope', left(coalesce(p_scope, ''), 40)
      )
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'house', to_jsonb(saved),
    'previous_wait', prev.wait_minutes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Game score: keep the best, in one statement
-- ---------------------------------------------------------------------------

create or replace function public.scream_save_score(p_number text, p_game text, p_score integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  kept integer;
begin
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  if p_game is null or p_game not in ('clicker', 'memory', 'catch') or p_score is null or p_score < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_score');
  end if;
  insert into public.game_scores as t (student_number, game_id, score, updated_at)
  values (n, p_game, p_score, now())
  on conflict (student_number, game_id) do update
    set score = excluded.score, updated_at = now()
    where excluded.score > t.score
  returning t.score into kept;
  if found then
    return jsonb_build_object('ok', true, 'best', kept, 'updated', true);
  end if;
  select score into kept from public.game_scores where student_number = n and game_id = p_game;
  return jsonb_build_object('ok', true, 'best', coalesce(kept, p_score), 'updated', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Feedback: the same note twice within a minute is stored once
-- ---------------------------------------------------------------------------

create or replace function public.scream_add_feedback(
  p_kind text,
  p_target text,
  p_message text,
  p_rating smallint,
  p_student text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stu text := nullif(trim(coalesce(p_student, '')), '');
begin
  if stu is not null and exists (
    select 1 from public.event_feedback f
    where f.student_number = stu
      and f.kind = p_kind
      and f.target_id = p_target
      and f.message = p_message
      and f.rating is not distinct from p_rating
      and f.created_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  insert into public.event_feedback (kind, target_id, message, rating, student_number)
  values (p_kind, p_target, p_message, p_rating, stu);
  return jsonb_build_object('ok', true, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: service role only, never the public anon key
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.scream_versions()',
    'public.scream_student_sign_in(text, text)',
    'public.scream_set_wait(text, integer, boolean, text, text, timestamptz)',
    'public.scream_save_score(text, text, integer)',
    'public.scream_add_feedback(text, text, text, smallint, text)',
    'public.scream_touch_updated_at()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ===========================================================================
-- signin-fast section (same statements as supabase/signin-fast.sql, for fresh setups)
-- ===========================================================================

-- SP Scream Fest: fast student sign-in for the door rush.
-- Safe to re-run (CREATE OR REPLACE, IF NOT EXISTS). Run the whole file once in the Supabase
-- SQL editor of the EXISTING project, after schema.sql and scale-3000.sql.
-- (The same statements are appended to the end of schema.sql for fresh setups.)
--
-- Why
--   A sign-in used to be three separate API calls from the server to the database, one after the
--   other: the per-IP rate limit, the per-number rate limit, then the sign-in itself. Every
--   sign-in from one IP (one campus Wi-Fi gateway) also bumped the same rate-limit row, so
--   parallel sign-ins queued on that one row lock.
--
-- What it adds
--   1. scream_rate_hit_sharded: the same fixed-window counter as scream_rate_hit, spread over
--      16 rows per bucket. Each hit locks one random shard; the limit is the sum of the shards.
--   2. scream_student_login: both rate limits and the conflict-safe sign-in in ONE call and one
--      transaction. The number and name are checked first, exactly like before.
--   No password hashing anywhere on this path. The old functions stay, so older code keeps working.

-- ---------------------------------------------------------------------------
-- 1. Sharded rate limit (no single hot row)
-- ---------------------------------------------------------------------------

create index if not exists scream_rate_limits_window_idx on public.scream_rate_limits (window_start);

create or replace function public.scream_rate_hit_sharded(
  p_bucket text,
  p_max integer,
  p_window_seconds integer,
  p_shards integer default 16
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  win interval := make_interval(secs => greatest(1, p_window_seconds));
  shards integer := greatest(1, least(64, coalesce(p_shards, 16)));
  keys text[];
  total integer;
  oldest timestamptz;
begin
  if p_bucket is null or length(p_bucket) < 3 or length(p_bucket) > 180 then
    return jsonb_build_object('ok', false, 'retry_after', 60);
  end if;
  -- Lock only one shard. Two parallel sign-ins from the same IP almost never pick the same one.
  insert into public.scream_rate_limits as t (bucket, hits, window_start)
  values (p_bucket || '#' || floor(random() * shards)::int, 1, now())
  on conflict (bucket) do update set
    hits = case when t.window_start < now() - win then 1 else t.hits + 1 end,
    window_start = case when t.window_start < now() - win then now() else t.window_start end;
  -- Plain read of all shards (primary-key lookups, no locks).
  select array_agg(p_bucket || '#' || g) into keys from generate_series(0, shards - 1) g;
  select coalesce(sum(hits), 0)::int, min(window_start) into total, oldest
  from public.scream_rate_limits
  where bucket = any (keys) and window_start >= now() - win;
  if random() < 0.01 then
    delete from public.scream_rate_limits where window_start < now() - interval '1 day';
  end if;
  return jsonb_build_object(
    'ok', total <= greatest(1, p_max),
    'hits', total,
    'retry_after', greatest(0, ceil(extract(epoch from (coalesce(oldest, now()) + win - now())))::int)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. One-call student sign-in: rate limits + conflict-safe sign-in, one transaction
-- ---------------------------------------------------------------------------

create or replace function public.scream_student_login(
  p_number text,
  p_name text,
  p_ip text,
  p_ip_max integer,
  p_num_max integer,
  p_window_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n text;
  nm text;
  gate jsonb;
begin
  -- Same validation as scream_student_sign_in, before anything is counted.
  n := public.scream_norm_number(p_number);
  if n is null then
    return jsonb_build_object('ok', false, 'error', 'bad_number');
  end if;
  nm := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  if char_length(nm) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;

  -- Per IP: generous (campus Wi-Fi shares a few IPs), sharded so it never serialises.
  gate := public.scream_rate_hit_sharded(
    'login-ip:' || left(coalesce(nullif(trim(p_ip), ''), 'unknown'), 64),
    p_ip_max,
    p_window_seconds
  );
  if not coalesce((gate ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', gate -> 'retry_after');
  end if;

  -- Per number: tight, one row (only this student's own attempts touch it).
  gate := public.scream_rate_hit('login-num:' || n, p_num_max, p_window_seconds);
  if not coalesce((gate ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'retry_after', gate -> 'retry_after');
  end if;

  return public.scream_student_sign_in(n, nm);
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: service role only, never the public anon key
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.scream_rate_hit_sharded(text, integer, integer, integer)',
    'public.scream_student_login(text, text, text, integer, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
