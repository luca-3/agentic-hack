# Hosting: Codesphere + Supabase Cloud (D-39)

- **Codesphere** (Workspace `https://691180.1.cloud.codesphere.com`, `ci.valo.yml`) hostet nur die zwei Next.js-Apps: `/` → Dashboard, `/api` → Server (`/api/lotse/*`, `/api/knowledge/*`). Jeder Dienst läuft in einem eigenen Container auf Port 3000.
- **Supabase Cloud** (Projekt `jskpfugcnhmcujlsyyhh`, eu-central-1) liefert Datenbank, Anmeldung und Vektorsuche. Der Code bleibt unverändert.
- Das Repo ist **öffentlich** (samt Historie): Geheimes nur als Codesphere-Variable bzw. im Supabase-Dashboard. Die Workspaces CORPUS (dev.fuller.de) und fuller-dashboard (app.fuller.de) werden nicht angefasst.

## Schritte

1. **Migrationen** (Koordinator, Supabase-CLI im Repo-Hauptordner):
   `npx supabase link --project-ref jskpfugcnhmcujlsyyhh` → `npx supabase db push`. Danach im Supabase-Dashboard prüfen: Database → Extensions → `vector` aktiv; Advisors → Security ohne „RLS disabled“.
2. **Supabase-Einstellungen** (Dashboard):
   - Authentication → Sign In / Providers → Email: **„Allow new users to sign up“ AUS**, **„Confirm email“ AUS**.
   - Authentication → URL Configuration: **Site URL** = `https://691180.1.cloud.codesphere.com`.
3. **Codesphere-Variablen** (schreibt der Koordinator):

   | Variable | Wert |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://jskpfugcnhmcujlsyyhh.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (Supabase → Settings → API Keys) |
   | `SUPABASE_SECRET_KEY` | `sb_secret_…` (ebenda, nur hier eintragen) |
   | `GEMINI_API_KEY` | Gemini-Schlüssel |
   | `LOTSE_SERVER_URL` | `https://691180.1.cloud.codesphere.com` |
   | `LOTSE_PSEUDONYM_SALT` | neuer Zufallswert, z. B. `openssl rand -hex 32` |

   **Nie** `LOTSE_DEV_AUTH` setzen (der Server startet dann nicht; sonst gingen Gemini-Aufrufe ohne Login durch). `NODE_ENV=production` setzt das Startskript.
4. **Node** im Workspace einmal: `fnm install 24.22.1`. Dann die **Pipeline** starten (prepare = `npm ci`, Erweiterung als ZIP mit `WXT_LOTSE_SERVER_URL=$LOTSE_SERVER_URL` → `apps/dashboard/public/valo-extension.zip` (Download unter `/install`; bricht ab, wenn `LOTSE_SERVER_URL` leer ist), dann Build beider Apps; test = typecheck; run = dashboard + server). Die `NEXT_PUBLIC_*`-Werte werden beim Build eingebaut, deshalb Schritt 3 vorher.
5. **Testdaten** (lokal, die lokale Supabase muss laufen):
   ```bash
   bash infra/codesphere/copy-local-data.sh          # → infra/codesphere/dump.sql (gitignored)
   read -rs DATABASE_URL; export DATABASE_URL        # Verbindungszeile aus Supabase → Connect (mit DB-Passwort)
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f infra/codesphere/dump.sql
   ```
   Pro Tabelle steht eine Anweisung auf einer Zeile. Ohne psql lassen sich die Zeilen einzeln im Supabase-SQL-Editor oder per MCP `execute_sql` ausführen (in Reihenfolge).
   - **Kopiert werden:** die Demo-Konten `*@demo.test`, Org und Mitglieder, die Apps, die Funktionen von Kundenwerk CRM und Erasmus, das Kundenwerk-Wissen mitsamt Embeddings (kein Gemini-Aufruf), Insights und Notizen.
   - **Nicht kopiert:** alle Funktionen, das Wissen, die Trainings, Vorschläge, Erinnerungen und Lücken zu CORPUS sowie alle lokalen Laufzeit-Logs. Nur die App-Zeile „CORPUS“ (Name und Domains) geht mit, die der Server für die Fuhrpark-Sperre braucht. Das Skript bricht ab, wenn CORPUS woanders vorkommt.
6. **Sofort danach neue Demo-Passwörter** (`demo1234` steht öffentlich im Repo):
   `bash infra/codesphere/reset-demo-passwords.sh` (gleiche `DATABASE_URL`). Das Skript gibt neue Zufallspasswörter für alle `*@demo.test`-Konten nur auf stdout aus (in den Passwort-Manager, nirgends speichern) und beendet alte Sitzungen. Dann `unset DATABASE_URL` und `rm infra/codesphere/dump.sql`.
7. **Prüfen:** Login auf `https://691180.1.cloud.codesphere.com/` als `admin@demo.test` mit dem neuen Passwort.

**Rückfall:** Lokal läuft alles weiter wie bisher (`npm run db:start`, `dev:server`, `dev:dashboard`).

## Grenzen und Übergaben

- Status-Seite `/` und `/chat` des Servers sind unter der Domain nicht erreichbar (`/` gehört dem Dashboard), nur `/api/*`.
- Registrierung ist aus: `/signup` des Dashboards (neue Organisation) geht in der Cloud nicht. Mitglieder legt ein Admin über `/team` an. Login-Hinweis und Signup-Meldung übernimmt die Sitzung valo-nutzerverwaltung.
- Erweiterung (Nils): Die Server-URL kommt per Build-Variable, und `https://691180.1.cloud.codesphere.com/*` sowie `https://jskpfugcnhmcujlsyyhh.supabase.co/*` gehören in `host_permissions`. Die Login-Daten liefert schon der Server (`/api/lotse/auth-config`).
- Server-CORS (Luca): keine Änderung nötig. Das Dashboard ruft den Server nur serverseitig auf, und `chrome-extension://` ist schon erlaubt.
