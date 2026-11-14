-- Valo on Codesphere: one-time DB bootstrap, run as the superuser BEFORE migrate.sh (same user as DATABASE_URL).
-- Recreates the parts of the Supabase init scripts (supabase/postgres) our migrations and seeds need:
-- API roles for PostgREST, a login role + schema for GoTrue, the extensions schema and Supabase-style grants.
-- auth.users / auth.uid() are created later by GoTrue's own migrations (migrate.sh).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v authenticator_pw="$AUTHENTICATOR_PW" -v auth_admin_pw="$AUTH_ADMIN_PW" \
--     -f infra/codesphere/bootstrap.sql
--
-- Idempotent: safe to run again (also rotates the two passwords).

\set ON_ERROR_STOP on

-- Roles -----------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login noinherit; end if;
  -- GoTrue migration 20240612123726 grants "select ... to postgres with grant option" → the role must exist.
  if not exists (select from pg_roles where rolname = 'postgres') then create role postgres nologin; end if;
end $$;

alter role service_role bypassrls;
alter role authenticator with login noinherit password :'authenticator_pw';
alter role supabase_auth_admin with login noinherit password :'auth_admin_pw';
grant anon, authenticated, service_role to authenticator;

-- GoTrue: owns schema auth and runs its migrations there.
create schema if not exists auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;
-- The migration user (us) needs auth.users for FKs, the last-admin guard and the data copy (users + identities).
do $$ begin
  execute format('grant usage on schema auth to %I', current_user);
  execute format('alter default privileges for role supabase_auth_admin in schema auth grant all on tables to %I', current_user);
end $$;

-- Extensions ------------------------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role, supabase_auth_admin;
-- If the provider pre-installed pgcrypto/vector in another schema, move it: seeds call extensions.crypt().
do $$
declare e text;
begin
  foreach e in array array['pgcrypto', 'vector'] loop
    if exists (select from pg_extension x join pg_namespace n on n.oid = x.extnamespace
               where x.extname = e and n.nspname <> 'extensions') then
      execute format('alter extension %I set schema extensions', e);
    end if;
  end loop;
end $$;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;

-- public: Supabase defaults (API roles get table rights, RLS decides). Default privileges apply to
-- objects this user creates, i.e. everything migrate.sh creates.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
alter default privileges in schema extensions grant execute on routines to anon, authenticated, service_role;
