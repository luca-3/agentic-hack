# Hosting auf Codesphere (Plan A)

Ein Workspace **valo**, eine Domain `https://<workspace>`, Pfad-Verteilung (`ci.valo.yml`):

| Pfad | Dienst | stripPath |
| --- | --- | --- |
| `/` | dashboard (Next.js) | nein |
| `/api` | server (Next.js, `/api/lotse/*`, `/api/knowledge/*`) | nein |
| `/rest/v1` | PostgREST v16.5 | ja |
| `/auth/v1` | GoTrue (supabase/auth) v2.197.0 | ja |

DB: Codesphere Managed PostgreSQL 18.6 `valo-db` (DB `valo`). Code von Dashboard und Server bleibt unverändert (supabase-js spricht `/rest/v1` und `/auth/v1`). Jeder Dienst läuft in einem eigenen Container auf Port 3000. Skripte: `infra/codesphere/`.

Das Repo ist **öffentlich** (inkl. Historie) – alles Geheime nur als Codesphere-Workspace-Variable. Codesphere klont per URL `https://github.com/luca-3/agentic-hack.git`. Die Workspaces CORPUS (dev.fuller.de) und fuller-dashboard (app.fuller.de) werden nicht angefasst.

## Schritte (in dieser Reihenfolge)

1. **DB prüfen** (als Superuser, z. B. über die Codesphere-Konsole):
   ```sql
   select rolsuper, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user;
   select name, default_version, installed_version from pg_available_extensions where name in ('vector', 'pgcrypto');
   ```
   Postgres bleibt **nur intern** erreichbar (Managed Service, keine öffentliche Freigabe, kein Pfad in `ci.valo.yml`); von außen nur `/rest/v1` und `/auth/v1`. Nötig: `rolsuper` = true (oder mindestens CREATEROLE + BYPASSRLS + Recht, BYPASSRLS zu vergeben) und beide Erweiterungen verfügbar. Ohne `vector` kein RAG, Plan A stoppt hier.
2. **JWTs erzeugen** (lokal): neues `JWT_SECRET` mit ≥ 64 Zeichen, `openssl rand -base64 64 | tr -d '\n'` – **nie** den lokalen Supabase-Standardwert (das Skript lehnt ihn und alles unter 64 Zeichen ab). Dann
   `JWT_SECRET=… node infra/codesphere/make-jwts.mjs` → zwei Zeilen (anon / service_role). Service-JWT, `JWT_SECRET` und Superuser-Passwort stehen danach **nur** in den Codesphere-Variablen.
3. **Workspace-Variablen eintragen** (Codesphere → Env vars; gelten für alle Dienste und für prepare):

   | Variable | Wert |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<workspace>` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon-JWT aus Schritt 2 |
   | `SUPABASE_SECRET_KEY` | service_role-JWT aus Schritt 2 |
   | `JWT_SECRET` | Geheimnis aus Schritt 2 |
   | `DATABASE_URL` | `postgres://<superuser>:…@<host>:5432/valo` (Migrationen) |
   | `AUTHENTICATOR_DB_URL` | `postgres://authenticator:<authenticator_pw>@<host>:5432/valo` (PostgREST) |
   | `GOTRUE_DB_URL` | `postgres://supabase_auth_admin:<auth_admin_pw>@<host>:5432/valo` (GoTrue) |
   | `API_EXTERNAL_URL` | `https://<workspace>/auth/v1` |
   | `SITE_URL` | `https://<workspace>` |
   | `GEMINI_API_KEY` | Gemini-Schlüssel |
   | `LOTSE_KNOWLEDGE_SOURCE` | `db` |
   | `LOTSE_SERVER_URL` | `https://<workspace>` |
   | optional `GOTRUE_MAILER_AUTOCONFIRM` | Standard `true` (Autoconfirm an, kein SMTP) |
   | optional `LOTSE_*` | wie `.env.example` – aber **nie** `LOTSE_DEV_AUTH` (Server startet sonst nicht) |

   Fest im Skript, nicht als Variable: `GOTRUE_DISABLE_SIGNUP=true` (keine Selbstregistrierung, Konten nur per Einladung/Dashboard `/team`), Server immer `NODE_ENV=production`.

   Sonderzeichen in Passwörtern in den URLs prozent-kodieren. Die neuen Schlüssel `sb_publishable_…`/`sb_secret_…` funktionieren hier **nicht** (die tauscht nur Supabases Gateway gegen ein JWT).
4. **Node** im neuen Workspace einmal: `fnm install 24.22.1`.
5. **Bootstrap** (einmal, im Workspace-Terminal; die zwei Passwörter sind die aus `AUTHENTICATOR_DB_URL` / `GOTRUE_DB_URL`, Eingabe verdeckt, nicht in der Shell-History):
   ```bash
   command -v psql || nix-env -iA nixpkgs.postgresql_18
   read -rs -p 'authenticator pw: ' A; echo; read -rs -p 'auth admin pw: ' G; echo
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v authenticator_pw="$A" -v auth_admin_pw="$G" -f infra/codesphere/bootstrap.sql; unset A G
   ```
6. **Pipeline starten** (CI-Datei `ci.valo.yml`): prepare baut, lädt die Binärdateien, führt `migrate.sh` aus (GoTrue-Migrationen, dann `supabase/migrations/*.sql`, gemerkt in `public.schema_migrations_valo`). Dann test (typecheck), dann run.
7. **Daten kopieren** (einmal, nach der ersten Migration, auf leere Tabellen): lokal `bash infra/codesphere/copy-local-data.sh` (lokale Supabase muss laufen) → `infra/codesphere/dump.sql` (gitignored, nur Testdaten inkl. Embeddings, kein Gemini-Aufruf). Die DB ist nur intern erreichbar → `dump.sql` per Codesphere-Datei-Upload nach `/home/user/app/infra/codesphere/` legen und **im Workspace-Terminal** einspielen:
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f infra/codesphere/dump.sql` (psql aus Schritt 5). Danach `dump.sql` im Workspace löschen. Sofort danach **Demo-Passwörter ersetzen** (`demo1234` steht öffentlich im Repo): `bash infra/codesphere/reset-demo-passwords.sh` → neue Zufallspasswörter aller `*@demo.test`-Konten nur auf stdout (in den Passwort-Manager, nirgends speichern), alte Sitzungen werden beendet.
8. **Prüfen**: `https://<workspace>/` (Login), `https://<workspace>/auth/v1/health`, `https://<workspace>/rest/v1/` (OpenAPI).

**Rückfall:** klappt etwas nicht, läuft alles weiter lokal (`npm run db:start`, `dev:server`, `dev:dashboard`); die Codesphere-Dateien schaden lokal nicht.

## Grenzen

- Status-Seite `/` und `/chat` des Servers sind unter der Domain nicht erreichbar (`/` gehört dem Dashboard), nur `/api/*`.
- Kein SMTP: Passwort-Reset per Mail geht nicht; Konten anlegen über das Dashboard (`auth.admin.createUser`) oder Sign-up mit Autoconfirm.
- Kein Realtime/Storage (nutzen wir nicht).
- Registrierung aus: `/signup` des Dashboards (neue Organisation per `supabase.auth.signUp`) schlägt auf Codesphere fehl; Mitglieder legt ein Admin über `/team` an (Admin-API, nicht betroffen).

## Für das Dashboard (Login-Seite – hier nicht geändert)

`apps/dashboard/src/app/login/page.tsx:39–40`: den Hinweis `Demo: admin@demo.test · demo1234` und den `defaultValue="admin@demo.test"` nur anzeigen, wenn `process.env.NODE_ENV !== "production"`.

## Für Nils (Erweiterung, `apps/extension` – hier nicht geändert)

- Server-URL per Build-Variable statt fest `LOTSE_DEFAULTS.serverUrl` (z. B. `import.meta.env.WXT_LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl` in `background.ts`), Build mit `WXT_LOTSE_SERVER_URL=https://<workspace>`.
- Supabase-Login der Erweiterung: nichts zu tun, URL und anon-JWT kommen vom Server (`GET /api/lotse/auth-config`).
- `host_permissions` in `wxt.config.ts` um `https://<workspace>/*` ergänzen (sonst blockiert Chrome die Aufrufe des Service Workers an Server und `/auth/v1`).

## Für Luca (Server-CORS)

Keine Änderung nötig: das Dashboard ruft den Server nur serverseitig (Server Actions/Pages per `fetch`) auf, nicht aus dem Browser; die Erweiterung kommt mit `chrome-extension://…`, das `apps/server/src/lib/cors.ts` schon erlaubt. Erst wenn Browser-Code des Dashboards direkt `/api/*` aufruft, ist es ohnehin dieselbe Domain (kein CORS).
