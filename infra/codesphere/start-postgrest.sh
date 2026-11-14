#!/usr/bin/env bash
# Codesphere run service "postgrest" (path /rest/v1, stripPath). Logs in as authenticator, switches to the
# role in the JWT (anon / authenticated / service_role). Settings mirror supabase/config.toml [api].
set -u
cd "$(dirname "$0")/../.."
: "${AUTHENTICATOR_DB_URL:?set AUTHENTICATOR_DB_URL (postgres://authenticator:…@…/valo)}"
: "${JWT_SECRET:?set JWT_SECRET}"
pkill -f 'bin/postgrest$' 2>/dev/null && sleep 2
export PGRST_DB_URI="$AUTHENTICATOR_DB_URL"
export PGRST_JWT_SECRET="$JWT_SECRET"
export PGRST_DB_SCHEMAS=public
export PGRST_DB_EXTRA_SEARCH_PATH=public,extensions
export PGRST_DB_ANON_ROLE=anon
export PGRST_DB_MAX_ROWS=1000
export PGRST_SERVER_HOST='*'
export PGRST_SERVER_PORT=3000
exec "$PWD/bin/postgrest"
