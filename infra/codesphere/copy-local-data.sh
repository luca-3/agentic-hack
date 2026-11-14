#!/usr/bin/env bash
# Dumps the DATA (no schema) of the local Supabase DB → infra/codesphere/dump.sql (gitignored):
# every table in public (seeds, demo knowledge incl. embeddings → no new Gemini calls) plus
# auth.users + auth.identities (test logins *@demo.test). Test data only — never run against real data.
#
# Load into the Codesphere DB once, right after migrate.sh on an EMPTY database:
#   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f infra/codesphere/dump.sql
# (psql ≥ 17.6 locally: the dump contains \restrict lines.)
set -euo pipefail
cd "$(dirname "$0")"

container="$(docker ps --filter name=supabase_db_ --format '{{.Names}}' | head -1)"
[ -n "$container" ] || { echo "local Supabase DB container (supabase_db_*) not running — npm run db:start"; exit 1; }

docker exec "$container" pg_dump -U postgres -d postgres \
  --data-only --no-owner --no-privileges \
  --schema=public --table=auth.users --table=auth.identities \
  --exclude-table=public.schema_migrations_valo \
  > dump.sql

echo "wrote $(pwd)/dump.sql ($(grep -c '^COPY ' dump.sql) tables)"
