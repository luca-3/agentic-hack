#!/usr/bin/env bash
# Codesphere run service "gotrue" (path /auth/v1, stripPath). Env mapping in gotrue-env.sh.
set -u
cd "$(dirname "$0")/../.."
# shellcheck source=gotrue-env.sh
source infra/codesphere/gotrue-env.sh
pkill -f 'bin/gotrue/auth serve' 2>/dev/null && sleep 2
exec "$PWD/bin/gotrue/auth" serve
