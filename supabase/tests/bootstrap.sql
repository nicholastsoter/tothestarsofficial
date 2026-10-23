-- Test-only stand-in for the parts of a Supabase project that exist before our migrations run:
-- the three API roles, the auth schema, the storage schema, and Supabase's default grants.
-- Lets us run the real migrations on plain Postgres without Docker.

create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'
);

-- Same logic as Supabase's auth.uid(): read the user id from the request's JWT claims.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[] language plpgsql as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Supabase's real default: every new public table is wide open to anon/authenticated
-- (RLS is what's supposed to protect it). Reproduced so the tests prove our migrations undo it.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
