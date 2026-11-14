#!/usr/bin/env bash
# Run once on Codesphere right after loading dump.sql: the seed passwords (demo1234) are public in the repo.
# Gives every *@demo.test account a new random password (bcrypt via extensions.crypt, like the seed) and ends
# their sessions. New passwords go to stdout ONLY — note them in a password manager, nowhere else.
#   psql needs DATABASE_URL (superuser):  bash infra/codesphere/reset-demo-passwords.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL (superuser)}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q -1 -tA -F ' ' <<'SQL'
create temp table new_pw on commit drop as
  select id, email, translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_') as pw
  from auth.users where email like '%@demo.test';
update auth.users u
  set encrypted_password = extensions.crypt(n.pw, extensions.gen_salt('bf')), updated_at = now()
  from new_pw n where u.id = n.id;
delete from auth.sessions s using new_pw n where s.user_id = n.id;        -- cascades to refresh tokens
delete from auth.refresh_tokens r using new_pw n where r.user_id = n.id::text;
select email, pw from new_pw order by email;
SQL
