# Sourced by migrate.sh and start-gotrue.sh: maps the Codesphere workspace variables to GoTrue's names.
# Required workspace variables: GOTRUE_DB_URL, JWT_SECRET, API_EXTERNAL_URL, SITE_URL.
: "${GOTRUE_DB_URL:?set GOTRUE_DB_URL (postgres://supabase_auth_admin:…@…/valo)}"
: "${JWT_SECRET:?set JWT_SECRET}"
: "${API_EXTERNAL_URL:?set API_EXTERNAL_URL (https://<workspace>/auth/v1)}"
: "${SITE_URL:?set SITE_URL (https://<workspace>)}"

GOTRUE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bin/gotrue"
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_DATABASE_URL="$GOTRUE_DB_URL"
export GOTRUE_DB_NAMESPACE=auth
export GOTRUE_DB_MIGRATIONS_PATH="$GOTRUE_DIR/migrations"
export API_EXTERNAL_URL
export GOTRUE_SITE_URL="$SITE_URL"
export GOTRUE_URI_ALLOW_LIST="$SITE_URL/**"
export GOTRUE_API_HOST=0.0.0.0
export PORT=3000
export GOTRUE_JWT_SECRET="$JWT_SECRET"
export GOTRUE_JWT_EXP=3600
export GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_ADMIN_ROLES=service_role
# Public repo + public domain: no self sign-up, accounts only via invite / dashboard (admin API, service key).
export GOTRUE_DISABLE_SIGNUP=true
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
export GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
# No SMTP on Codesphere: sign-ups are confirmed immediately (same as local, enable_confirmations = false).
export GOTRUE_MAILER_AUTOCONFIRM="${GOTRUE_MAILER_AUTOCONFIRM:-true}"
export GOTRUE_PASSWORD_MIN_LENGTH=6
