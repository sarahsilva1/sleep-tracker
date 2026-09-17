-- SweetSpot / wind-down tracker sync schema for Supabase (Postgres).
--
-- This is a full reset-and-recreate script, not an incremental migration —
-- safe for this project's current test-only data. Re-run this whole file in
-- the Supabase SQL editor whenever the schema changes.
--
-- Design: there is no username/password auth. Each device signs in
-- anonymously (Supabase anonymous auth) and joins exactly one "family" by
-- redeeming a short-lived, single-use setup code, which is never stored or
-- transmitted in plaintext after redemption. All data access is scoped by
-- Row Level Security to families the signed-in device has joined, via
-- auth.uid() — never by a client-supplied id, so a tampered request can't
-- read another family's data.
--
-- Enable anonymous sign-ins for this project once, outside of SQL:
-- Authentication -> Sign In / Providers -> "Allow anonymous sign-ins".

create extension if not exists pgcrypto;

drop table if exists redeem_attempts cascade;
drop table if exists setup_codes cascade;
drop table if exists day_notes cascade;
drop table if exists sleep_sessions cascade;
drop table if exists children cascade;
drop table if exists caregivers cascade;
drop table if exists family_members cascade;
drop table if exists families cascade;

create table families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table family_members (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- Pairing codes live in their own table, decoupled from family creation, so
-- an already-joined device can mint additional codes to invite a 3rd/4th
-- caregiver's device without creating a second, orphaned family. Each code
-- expires and can be redeemed at most once (see redeem_setup_code below).
create table setup_codes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id)
);

-- One row per redeem_setup_code call (success or failure), used only to rate
-- limit brute-force guessing. bcrypt already makes guessing slow; this caps
-- the attempt count too.
create table redeem_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index idx_redeem_attempts_user_time on redeem_attempts(user_id, attempted_at);

create table caregivers (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  first_name text not null,
  avatar text check (char_length(avatar) <= 4),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table children (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  date_of_birth date not null,
  avatar text check (char_length(avatar) <= 4),
  typical_bedtime text not null check (typical_bedtime ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  typical_wake_time text not null check (typical_wake_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  typical_nap_count int not null default 2 check (typical_nap_count between 0 and 4),
  hidden boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table sleep_sessions (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz,
  excluded boolean not null default false,
  logged_by uuid references caregivers(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table day_notes (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  date date not null,
  text text not null,
  author uuid references caregivers(id),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index idx_caregivers_family_updated on caregivers(family_id, updated_at);
create index idx_children_family_updated on children(family_id, updated_at);
create index idx_sessions_family_updated on sleep_sessions(family_id, updated_at);
create index idx_notes_family_updated on day_notes(family_id, updated_at);

-- Row Level Security: every domain table is scoped to families the current
-- device (auth.uid()) has joined. `families`, `setup_codes` and
-- `redeem_attempts` have RLS enabled with zero policies — no direct client
-- access at all; they're only ever touched by the SECURITY DEFINER
-- functions below.

alter table families enable row level security;
alter table family_members enable row level security;
alter table setup_codes enable row level security;
alter table redeem_attempts enable row level security;
alter table caregivers enable row level security;
alter table children enable row level security;
alter table sleep_sessions enable row level security;
alter table day_notes enable row level security;

create policy "members can see their own membership"
  on family_members for select
  using (user_id = auth.uid());

create policy "read own family's caregivers"
  on caregivers for select
  using (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "write own family's caregivers"
  on caregivers for insert
  with check (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "update own family's caregivers"
  on caregivers for update
  using (family_id in (select family_id from family_members where user_id = auth.uid()));

create policy "read own family's children"
  on children for select
  using (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "write own family's children"
  on children for insert
  with check (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "update own family's children"
  on children for update
  using (family_id in (select family_id from family_members where user_id = auth.uid()));

create policy "read own family's sessions"
  on sleep_sessions for select
  using (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "write own family's sessions"
  on sleep_sessions for insert
  with check (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "update own family's sessions"
  on sleep_sessions for update
  using (family_id in (select family_id from family_members where user_id = auth.uid()));

create policy "read own family's notes"
  on day_notes for select
  using (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "write own family's notes"
  on day_notes for insert
  with check (family_id in (select family_id from family_members where user_id = auth.uid()));
create policy "update own family's notes"
  on day_notes for update
  using (family_id in (select family_id from family_members where user_id = auth.uid()));

-- Generates an 8-character code from an unambiguous alphabet (no 0/O, 1/I),
-- formatted XXXX-XXXX, hashes it with bcrypt, and stores a setup_codes row
-- for the given family with a 30-minute expiry. Returns the plaintext code
-- once — it is never stored anywhere. Shared by create_family (first code)
-- and create_setup_code (additional codes for a 3rd/4th device).
create or replace function generate_setup_code_for_family(p_family_id uuid, p_ttl_minutes int default 30)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  v_code := (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ceil(random() * 33)::int, 1), '')
    from generate_series(1, 8)
  );
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);

  insert into setup_codes (family_id, code_hash, expires_at)
  values (p_family_id, crypt(v_code, gen_salt('bf')), now() + (p_ttl_minutes || ' minutes')::interval);

  return v_code;
end;
$$;

-- Creates a new family, joins the caller to it, and returns a one-time
-- setup code for pairing the second device.
create or replace function create_family()
returns table (family_id uuid, setup_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  insert into families default values returning id into v_family_id;
  insert into family_members (family_id, user_id) values (v_family_id, auth.uid());

  return query select v_family_id, generate_setup_code_for_family(v_family_id);
end;
$$;

-- Mints an additional setup code for the caller's existing family, so a
-- 3rd or 4th caregiver's device can be paired without creating a new,
-- orphaned family. Fails if the caller hasn't joined a family yet.
create or replace function create_setup_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select family_id into v_family_id
  from family_members
  where user_id = auth.uid()
  limit 1;

  if v_family_id is null then
    raise exception 'not part of a family yet';
  end if;

  return generate_setup_code_for_family(v_family_id);
end;
$$;

-- Redeems a setup code, joining the caller's anonymous auth user to that
-- family. Rate-limited to 10 attempts per 15 minutes per caller. Codes
-- expire after 30 minutes and can only be redeemed once.
create or replace function redeem_setup_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_setup_code_id uuid;
  v_recent_attempts int;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  select count(*) into v_recent_attempts
  from redeem_attempts
  where user_id = auth.uid() and attempted_at > now() - interval '15 minutes';

  if v_recent_attempts >= 10 then
    raise exception 'too many attempts, please try again later';
  end if;

  insert into redeem_attempts (user_id) values (auth.uid());

  select id, family_id into v_setup_code_id, v_family_id
  from setup_codes
  where used_at is null
    and expires_at > now()
    and code_hash = crypt(code, code_hash)
  limit 1;

  if v_family_id is null then
    raise exception 'invalid or expired setup code';
  end if;

  update setup_codes set used_at = now(), used_by = auth.uid() where id = v_setup_code_id;

  insert into family_members (family_id, user_id)
  values (v_family_id, auth.uid())
  on conflict do nothing;

  return v_family_id;
end;
$$;

-- Session-loss recovery (decided, not built into schema): family membership
-- is tied to anonymous auth sessions in each browser's local storage. If a
-- device clears site data it loses access, but any other still-joined
-- device can mint a fresh invite code (create_setup_code) to re-pair it. If
-- *every* device loses its session simultaneously, the family is
-- unreachable — there is no recovery code. The accepted mitigation is that
-- each device's IndexedDB copy is unaffected (sync is a mirror, not the
-- source of truth), plus regular CSV/JSON export as an out-of-band backup
-- that can be imported into a freshly created family.
