-- SweetSpot sync schema for Supabase (Postgres).
-- Run this once in the Supabase SQL editor for a fresh project.
--
-- Design: there is no username/password auth. Each device signs in
-- anonymously (Supabase anonymous auth) and joins exactly one "family" by
-- redeeming a one-time setup code, which is never stored or transmitted in
-- plaintext after redemption. All data access is scoped by Row Level
-- Security to families the signed-in device has joined, via auth.uid() —
-- never by a client-supplied id, so a tampered request can't read another
-- family's data.

create extension if not exists pgcrypto;

-- Enable anonymous sign-ins for this project: Authentication -> Settings ->
-- "Allow anonymous sign-ins" in the Supabase dashboard (cannot be set via SQL).

create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  setup_code_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists family_members (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists children (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  date_of_birth date not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

create table if not exists sleep_sessions (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz,
  excluded boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

create table if not exists day_notes (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  date date not null,
  text text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false
);

create index if not exists idx_children_family_updated on children(family_id, updated_at);
create index if not exists idx_sessions_family_updated on sleep_sessions(family_id, updated_at);
create index if not exists idx_notes_family_updated on day_notes(family_id, updated_at);

-- Row Level Security: every table is scoped to families the current device
-- (auth.uid()) has joined. `families` itself has RLS enabled with zero
-- policies, i.e. no direct client access at all — it's only ever touched
-- by the SECURITY DEFINER functions below.

alter table families enable row level security;
alter table family_members enable row level security;
alter table children enable row level security;
alter table sleep_sessions enable row level security;
alter table day_notes enable row level security;

create policy "members can see their own membership"
  on family_members for select
  using (user_id = auth.uid());

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

-- Creates a new family and returns a one-time plaintext setup code.
-- The code is never stored — only its bcrypt hash is.
create or replace function create_family()
returns table (family_id uuid, setup_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;

  -- 8-char code from an unambiguous alphabet, formatted XXXX-XXXX.
  v_code := (
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ceil(random() * 33)::int, 1), '')
    from generate_series(1, 8)
  );
  v_code := substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4);

  insert into families (setup_code_hash) values (crypt(v_code, gen_salt('bf')))
  returning id into v_family_id;

  insert into family_members (family_id, user_id) values (v_family_id, auth.uid());

  return query select v_family_id, v_code;
end;
$$;

-- Redeems a setup code, joining the caller's anonymous auth user to that
-- family. Returns the family_id on success, raises on an invalid code.
create or replace function redeem_setup_code(code text)
returns uuid
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

  select id into v_family_id
  from families
  where setup_code_hash = crypt(code, setup_code_hash)
  limit 1;

  if v_family_id is null then
    raise exception 'invalid setup code';
  end if;

  insert into family_members (family_id, user_id)
  values (v_family_id, auth.uid())
  on conflict do nothing;

  return v_family_id;
end;
$$;
