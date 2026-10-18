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
