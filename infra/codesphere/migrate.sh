#!/usr/bin/env bash
# 1. GoTrue migrations (auth schema, auth.users, auth.uid()) as supabase_auth_admin.
# 2. supabase/migrations/*.sql in filename order as the superuser (DATABASE_URL), each file in one
#    transaction, recorded in public.schema_migrations_valo → already applied files are skipped.
# Seeds are NOT applied (copy data with copy-local-data.sh). Needs bootstrap.sql once before.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL (superuser)}"
command -v psql >/dev/null || { echo "psql missing (nix-env -iA nixpkgs.postgresql_18)"; exit 1; }

# shellcheck source=gotrue-env.sh
source infra/codesphere/gotrue-env.sh
bin/gotrue/auth migrate

psql() { command psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }

psql -c "create table if not exists public.schema_migrations_valo (
  version text primary key, applied_at timestamptz not null default now());
alter table public.schema_migrations_valo enable row level security;
revoke all on public.schema_migrations_valo from anon, authenticated;"

for f in supabase/migrations/*.sql; do
  v="$(basename "$f" .sql)"
  if [ "$(psql -tA -c "select 1 from public.schema_migrations_valo where version = '$v'")" = 1 ]; then
    continue
  fi
  echo "applying $v"
  # -1 = single transaction: the file and its bookkeeping row commit together or not at all.
  psql -1 -f "$f" -c "insert into public.schema_migrations_valo (version) values ('$v')"
done

psql -c "notify pgrst, 'reload schema'"
echo "migrations up to date"
