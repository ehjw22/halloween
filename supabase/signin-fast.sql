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
