-- JunctionNav: places people register, private to them or public for everyone.
--
-- Run this once in your Supabase project (Dashboard → SQL Editor → New query → paste → Run).
-- It is safe to run again: everything is created only if it is missing, and the rules are
-- replaced with these.
--
-- Who can do what (row level security):
--   - anyone, signed in or not, can read public places that have not been hidden by reports;
--   - a signed-in person can read, add, change and delete their own places, private or public;
--   - a signed-in person can report someone else's public place once; three reports from three
--     different people hide it from everyone but its owner.
-- Nobody can change who owns a place, its report count or whether it is hidden: those columns
-- are not granted to app users at all.

create table if not exists public.shared_places (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name text not null default '' check (char_length(owner_name) <= 60),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category text not null default 'other' check (category ~ '^[a-z]{1,16}$'),
  note text not null default '' check (char_length(note) <= 500),
  phone text not null default '' check (char_length(phone) <= 30),
  website text not null default '' check (char_length(website) <= 200),
  lon double precision not null check (lon between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  heading smallint check (heading between 0 and 359),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  reports integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_places_public_at on public.shared_places (lat, lon) where visibility = 'public' and not hidden;
create index if not exists shared_places_owner on public.shared_places (owner);

create table if not exists public.shared_place_reports (
  place_id uuid not null references public.shared_places (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (place_id, reporter)
);

-- The time of the last change, kept by the database.
create or replace function public.shared_places_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists shared_places_touch on public.shared_places;
create trigger shared_places_touch before update on public.shared_places
  for each row execute function public.shared_places_touch();

-- Counting reports and hiding a place runs with the table owner's rights (app users cannot
-- write these columns themselves).
create or replace function public.shared_places_count_reports() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.shared_place_reports where place_id = new.place_id;
  update public.shared_places set reports = n, hidden = (n >= 3) where id = new.place_id;
  return new;
end $$;

drop trigger if exists shared_place_reports_count on public.shared_place_reports;
create trigger shared_place_reports_count after insert on public.shared_place_reports
  for each row execute function public.shared_places_count_reports();

alter table public.shared_places enable row level security;
alter table public.shared_place_reports enable row level security;

drop policy if exists "read public places and your own" on public.shared_places;
create policy "read public places and your own" on public.shared_places for select
  using ((visibility = 'public' and not hidden) or owner = auth.uid());

drop policy if exists "add your own places" on public.shared_places;
create policy "add your own places" on public.shared_places for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "change your own places" on public.shared_places;
create policy "change your own places" on public.shared_places for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "delete your own places" on public.shared_places;
create policy "delete your own places" on public.shared_places for delete to authenticated
  using (owner = auth.uid());

drop policy if exists "report someone else's public place" on public.shared_place_reports;
create policy "report someone else's public place" on public.shared_place_reports for insert to authenticated
  with check (
    reporter = auth.uid()
    and exists (select 1 from public.shared_places p where p.id = place_id and p.visibility = 'public' and p.owner <> auth.uid())
  );

drop policy if exists "see your own reports" on public.shared_place_reports;
create policy "see your own reports" on public.shared_place_reports for select to authenticated
  using (reporter = auth.uid());

-- Only these columns can be written from the app.
revoke all on public.shared_places from anon, authenticated;
revoke all on public.shared_place_reports from anon, authenticated;
grant select on public.shared_places to anon, authenticated;
grant insert (id, owner_name, name, category, note, phone, website, lon, lat, heading, visibility) on public.shared_places to authenticated;
grant update (owner_name, name, category, note, phone, website, lon, lat, heading, visibility) on public.shared_places to authenticated;
grant delete on public.shared_places to authenticated;
grant select, insert (place_id, reason) on public.shared_place_reports to authenticated;
