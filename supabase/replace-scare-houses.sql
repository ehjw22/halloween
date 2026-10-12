-- Replace the old scare-house list with the Scream Fest clusters.
-- Paste this into the Supabase SQL editor and run it once.
-- Starting waits are placeholders. Staff can change them on the desk after this.

begin;

delete from public.scare_houses
where id not in (
  'three-doors',
  'marionette',
  'caligari',
  'clowns',
  'illusionist',
  'last-laugh',
  'cursed-cavern',
  'no-one-leaves',
  'prisoner',
  'whispering-woods',
  'slenderman',
  'he-who-watches',
  'abandoned-asylum',
  'forever-patients',
  'living-dead'
);

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
  set name = excluded.name,
      wait_minutes = excluded.wait_minutes,
      status = excluded.status,
      updated_at = now();

update public.announcements
set house_id = null
where house_id is not null
  and house_id not in (
    'three-doors',
    'marionette',
    'caligari',
    'clowns',
    'illusionist',
    'last-laugh',
    'cursed-cavern',
    'no-one-leaves',
    'prisoner',
    'whispering-woods',
    'slenderman',
    'he-who-watches',
    'abandoned-asylum',
    'forever-patients',
    'living-dead'
  );

-- Booth 07 (Screamometer) was rejected by the old 1–6 check.
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
  if booth !~ '^[1-7]$' then
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

commit;
