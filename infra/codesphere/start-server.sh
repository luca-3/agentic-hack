#!/usr/bin/env bash
# Codesphere run service "server" (path /api, no strip: routes stay /api/lotse/*, /api/knowledge/*).
# Port 3000: every Codesphere service runs in its own container and is reached on 3000.
set -u
# Never anonymous in production: LOTSE_DEV_AUTH=1 would allow Gemini calls without login.
if [ -n "${LOTSE_DEV_AUTH:-}" ] && [ "${LOTSE_DEV_AUTH}" != 0 ]; then echo "refusing to start: unset LOTSE_DEV_AUTH"; exit 1; fi
cd "$(dirname "$0")/../../apps/server"
pkill -f 'next/dist/bin/next start [-]p 3000' 2>/dev/null && sleep 2
NODE="$(fnm exec --using="${NODE_VERSION:-24.22.1}" -- node -p process.execPath)"
export NODE_ENV=production HOSTNAME=0.0.0.0
exec "$NODE" ../../node_modules/next/dist/bin/next start -p 3000 -H 0.0.0.0
