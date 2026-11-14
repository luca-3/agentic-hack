#!/usr/bin/env bash
# Exports the test data of the LOCAL Supabase DB → infra/codesphere/dump.sql (gitignored) for Supabase Cloud.
# What is copied / left out (no CORPUS feature info leaves the local DB): see export-test-data.sql.
# One SQL statement per line → load with psql, or line by line ("Häppchen") via the Supabase MCP execute_sql:
#   psql "<connection string from Supabase → Connect>" -v ON_ERROR_STOP=1 -1 -f infra/codesphere/dump.sql
# Run on Supabase Cloud AFTER the migrations, then immediately reset-demo-passwords.sh.
set -euo pipefail
cd "$(dirname "$0")"

container="$(docker ps --filter name=supabase_db_ --format '{{.Names}}' | head -1)"
[ -n "$container" ] || { echo "local Supabase DB container (supabase_db_*) not running — npm run db:start"; exit 1; }

docker exec -i "$container" psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1 \
  < export-test-data.sql | grep -v '^$' > dump.sql

# Guard: nothing mentioning CORPUS may end up in the file.
leak="$(grep -v '^insert into public.apps ' dump.sql | grep -ci 'corpus\|dev\.fuller\.de' || true)"
[ "$leak" = 0 ] || { echo "dump.sql mentions CORPUS outside public.apps ($leak lines) — not safe to upload"; exit 1; }

echo "wrote $(pwd)/dump.sql ($(wc -l < dump.sql | tr -d ' ') statements)"
