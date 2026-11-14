-- Dashboard demo data (owner: Dashboard). Test data only — no real people or customers.
-- Login (local Supabase Auth): admin@demo.test / demo1234 (org admin), buero@demo.test, monteur@demo.test (same password).

-- Test users
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('name', u.name), now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'admin@demo.test',   'Demo Admin'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'buero@demo.test',   'Demo Büro'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'monteur@demo.test', 'Demo Monteur')
) as u(id, email, name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u where u.email like '%@demo.test';

-- Org
insert into public.orgs (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'Fuller GmbH (Demo)');

insert into public.org_members (org_id, user_id, role, is_admin) values
  ('00000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'Büro', true),
  ('00000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000002', 'Büro', false),
  ('00000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000003', 'Monteur', false);

-- Apps. Ports: this app runs on :3000, so the local CORPUS test instance runs on :3100.
insert into public.apps (id, org_id, name, domains) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'CORPUS', '{localhost:3100}'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'Erasmus-Förderhelfer', '{localhost:3200}');

-- CORPUS features (derived from the CORPUS agent handbook; click paths to be verified on the local instance)
insert into public.app_features (app_id, name, route, click_path, description, required_role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Schlüssel finden', '/keys', 'Seitenleiste → Schlüssel → Suchfeld oben', 'Schneller: CORPUS-Chat (Kreis unten rechts) fragen: „Wo ist der Schlüssel für …?“', null),
  ('00000000-0000-0000-0000-0000000000a1', 'Schlüssel ausgeben', '/keys', 'Schlüssel → Kachel des Schlüssels → Ausgeben → Name eintragen', 'Braucht den Namen der Person bzw. Firma.', null),
  ('00000000-0000-0000-0000-0000000000a1', 'CORPUS-Chat fragen', '/', 'Kreis unten rechts → Frage eintippen', 'Beantwortet Fragen zu allen Modulen in Sekunden.', null),
  ('00000000-0000-0000-0000-0000000000a1', 'Aufgabe anlegen', '/tasks', 'Seitenleiste → Aufgaben → Neue Aufgabe', 'Pflicht: Titel, Beschreibung, Status, Priorität, Fällig bis.', null),
  ('00000000-0000-0000-0000-0000000000a1', 'Wochenzettel abgeben', '/wochenzettel', 'Seitenleiste → Wochenzettel → Woche öffnen → Tage füllen → Speichern → Abgeben', 'Abgabeschluss Freitag 19:00; abgegeben heißt gesperrt.', 'Monteur'),
  ('00000000-0000-0000-0000-0000000000a1', 'Notiz anlegen', '/notes', 'Seitenleiste → Notizen → Neue Notiz', 'Sichtbarkeit: Büro oder Alle.', null);

-- Erasmus helper features (placeholders — replace with the real screens)
insert into public.app_features (app_id, name, route, click_path, description, required_role) values
  ('00000000-0000-0000-0000-0000000000a2', 'Antrag anlegen', '/antraege', 'Anträge → Neuer Antrag', null, null),
  ('00000000-0000-0000-0000-0000000000a2', 'Teilnehmende importieren', '/teilnehmende', 'Teilnehmende → Importieren → CSV wählen', null, null),
  ('00000000-0000-0000-0000-0000000000a2', 'Budget prüfen', '/budget', 'Budget → Übersicht', null, null);

-- Training catalog
insert into public.training_catalog (org_id, title, topics) values
  ('00000000-0000-0000-0000-0000000000f1', 'CORPUS-Chat in 10 Minuten', '{CORPUS-Chat fragen,Schlüssel finden}'),
  ('00000000-0000-0000-0000-0000000000f1', 'Schlüsselverwaltung für Monteure', '{Schlüssel finden,Schlüssel ausgeben}'),
  ('00000000-0000-0000-0000-0000000000f1', 'Wochenzettel richtig abgeben', '{Wochenzettel abgeben}'),
  ('00000000-0000-0000-0000-0000000000f1', 'Aufgaben anlegen und zuweisen', '{Aufgabe anlegen}');

-- Insights (invented aggregates telling the demo story)
--  Schlüssel finden: many stuck, but the hint helps (low still_stuck) → training need
--  Wochenzettel abgeben: hint does NOT help (high still_stuck) → app problem
--  Notiz anlegen with 3 persons → below the min group of 5, stays invisible
insert into public.insights (org_id, app_id, feature, role, metric, value, persons) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Schlüssel finden', null, 'stuck_rate', 0.62, 11),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Schlüssel finden', null, 'still_stuck_after_hint', 0.18, 9),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Schlüssel finden', null, 'question_count', 23, 11),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Wochenzettel abgeben', 'Monteur', 'stuck_rate', 0.48, 8),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Wochenzettel abgeben', 'Monteur', 'still_stuck_after_hint', 0.71, 7),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Aufgabe anlegen', null, 'abandoned_flow', 0.44, 9),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Aufgabe anlegen', null, 'still_stuck_after_hint', 0.22, 6),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'Notiz anlegen', null, 'stuck_rate', 0.90, 3),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Teilnehmende importieren', null, 'still_stuck_after_hint', 0.64, 5),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Teilnehmende importieren', null, 'stuck_rate', 0.55, 5);
