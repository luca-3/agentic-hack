#!/usr/bin/env bash
# Downloads PostgREST and GoTrue (supabase/auth) for linux-amd64 into ./bin/ — fixed versions, SHA256-checked.
# Same versions as the local Supabase stack (supabase_rest / supabase_auth images). Idempotent.
set -euo pipefail
cd "$(dirname "$0")/../.."

POSTGREST_VERSION=v16.5
POSTGREST_SHA256=5099e7ada38f9f6846cd87c14c5f158b7c165f1e9959665ad412e61f4dceba95
GOTRUE_VERSION=v2.197.0
GOTRUE_SHA256=b5c2991d1df760c9b099c1c2395a94bd1c2f83ed58901934921997179dc9f7ea

mkdir -p bin
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() { # url sha256 → $tmp/archive
  curl -fsSL --retry 3 -o "$tmp/archive" "$1"
  echo "$2  $tmp/archive" | sha256sum -c -
}

if [ "$(cat bin/postgrest.version 2>/dev/null)" != "$POSTGREST_VERSION" ]; then
  fetch "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz" "$POSTGREST_SHA256"
  tar -xJf "$tmp/archive" -C bin postgrest
  echo "$POSTGREST_VERSION" > bin/postgrest.version
fi

# Archive holds the `auth` binary plus migrations/ → bin/gotrue/{auth,migrations}
if [ "$(cat bin/gotrue.version 2>/dev/null)" != "$GOTRUE_VERSION" ]; then
  fetch "https://github.com/supabase/auth/releases/download/$GOTRUE_VERSION/auth-$GOTRUE_VERSION-amd64.tar.xz" "$GOTRUE_SHA256"
  rm -rf bin/gotrue && mkdir -p bin/gotrue
  tar -xJf "$tmp/archive" -C bin/gotrue auth migrations
  echo "$GOTRUE_VERSION" > bin/gotrue.version
fi

bin/postgrest --version
