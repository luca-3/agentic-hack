#!/usr/bin/env bash
# Codesphere run service "dashboard" (path /). Pattern from CORPUS scripts/start-server.sh:
# end a leftover server (EADDRINUSE after restart), then exec node so the restart signal hits the server itself.
set -u
cd "$(dirname "$0")/../../apps/dashboard"
pkill -f 'next/dist/bin/next start [-]p 3000' 2>/dev/null && sleep 2
NODE="$(fnm exec --using="${NODE_VERSION:-24.22.1}" -- node -p process.execPath)"
export NODE_ENV=production HOSTNAME=0.0.0.0
exec "$NODE" ../../node_modules/next/dist/bin/next start -p 3000 -H 0.0.0.0
