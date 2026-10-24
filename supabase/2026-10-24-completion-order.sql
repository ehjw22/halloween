-- Completion order number for the prize ticket ("Nº 0007" = 7th student to fill all 5 stamps).
-- Safe to run more than once. Run it whole in the Supabase SQL editor.
--
-- * complete_no is handed out inside scream_award_stamp, on the row it already locks, the moment
--   the 5th stamp lands. One sequence nextval, no table scan, no shared counter row.
-- * Never reassigned: undoing a stamp keeps the number, and re-completing keeps the original.
-- * Load-test accounts (full name "Load Test ...") never get a number.
-- * Existing complete cards are backfilled in order of their 5th stamp's time.

begin;

alter table public.stamp_cards add column if not exists complete_no integer;
alter table public.stamp_cards add column if not exists completed_at timestamptz;
create unique index if not exists stamp_cards_complete_no_key
  on public.stamp_cards (complete_no) where complete_no is not null;
create sequence if not exists public.scream_complete_no_seq as integer minvalue 1 start 1;
revoke all on sequence public.scream_complete_no_seq from public, anon, authenticated;
grant usage on sequence public.scream_complete_no_seq to service_role;

-- Hold off concurrent stamp writes for the few milliseconds the backfill takes (reads still work).
lock table public.stamp_cards in share row exclusive mode;

with done as (
  select c.student_number,
         coalesce(
           to_timestamp(max(nullif(c.stamps -> b ->> 'at', '')::bigint) / 1000.0),
           c.updated_at
         ) as finished
  from public.stamp_cards c
  join public.students s on s.student_number = c.student_number
  cross join unnest(public.scream_stamp_booths()) b
  where c.complete_no is null
    and s.full_name not ilike 'load test%'
    and c.stamps ?& public.scream_stamp_booths()
  group by c.student_number, c.updated_at
),
numbered as (
  select student_number, finished,
         (select coalesce(max(complete_no), 0) from public.stamp_cards)
           + row_number() over (order by finished, student_number) as no
  from done
)
update public.stamp_cards c
   set complete_no = numbered.no,
       completed_at = coalesce(c.completed_at, numbered.finished)
  from numbered
 where c.student_number = numbered.student_number;

-- Next live completion continues after the highest number in use.
select setval(
  'public.scream_complete_no_seq',
  greatest(
    (select coalesce(max(complete_no), 0) from public.stamp_cards),
    (select last_value from public.scream_complete_no_seq where is_called),
    1
  ),
  (select coalesce(max(complete_no), 0) > 0 from public.stamp_cards)
    or (select is_called from public.scream_complete_no_seq)
);

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
      'student_number', n, 'full_name', s.full_name, 'stamps', c.stamps,
      'complete_no', c.complete_no
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
  -- 5th stamp: number this card once, on the row we already hold.
  if c.complete_no is null
     and c.stamps ?& public.scream_stamp_booths()
     and s.full_name not ilike 'load test%' then
    update public.stamp_cards
       set complete_no = nextval('public.scream_complete_no_seq'),
           completed_at = coalesce(completed_at, now())
     where student_number = n
    returning * into c;
  end if;
  insert into public.staff_audit (staff_id, action, target, detail)
  values (left(coalesce(p_staff, ''), 16), 'award_stamp', n, jsonb_build_object('boothId', booth));
  return jsonb_build_object(
    'ok', true, 'already', false,
    'student_number', n, 'full_name', s.full_name, 'stamps', c.stamps,
    'complete_no', c.complete_no
  );
end;
$$;

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
    'updated_at', c.updated_at,
    'complete_no', c.complete_no,
    'completed_at', c.completed_at
  );
end;
$$;

revoke all on function public.scream_award_stamp(text, text, text) from public, anon, authenticated;
grant execute on function public.scream_award_stamp(text, text, text) to service_role;
revoke all on function public.scream_lookup_student(text) from public, anon, authenticated;
grant execute on function public.scream_lookup_student(text) to service_role;

commit;

-- Check: select complete_no, student_number, completed_at from public.stamp_cards
--        where complete_no is not null order by complete_no;
