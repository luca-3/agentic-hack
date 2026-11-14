// Synthetic usage data for the insights pipeline (POST /api/insights/generate) — Kundenwerk CRM (localhost:4000),
// org "Fuller GmbH (Demo)" from seed-dev-org.mjs. All data is invented; local Supabase only; additive + idempotent, never deletes.
//   node apps/server/scripts/insights-seed-demo.mjs                   15 synthetic colleagues (roles) + ~10 days of events, offers, 👍/👎
//   node apps/server/scripts/insights-seed-demo.mjs --no-members      anonymous sessions only (no auth users, no roles)
//   node apps/server/scripts/insights-seed-demo.mjs --with-trainings  + 2 Kundenwerk trainings in training_catalog (only missing titles)
// Then: curl -s -X POST http://localhost:3001/api/insights/generate | jq
//
// Story (aggregates per feature; groups < 5 persons stay invisible, D-12):
//   IBAN ändern            → many errors, still stuck after the hint            → "App verbessern" (UI problem)
//   Angebot erstellen      → Vertrieb gets stuck at the prices, the hint helps → "Schulung" (+ role row Vertrieb)
//   Standard-Zahlungsziel  → people search the global search for it, hint helps → "Schulung" + UX: hard to find
//   Neue Aufgabe / Kunden suchen → fine; Notiz (3 persons) → suppressed

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.resolve(here, "../../../.env.local"));

const ORG_ID = "00000000-0000-0000-0000-0000000000f1";
const APP_ID = "00000000-0000-0000-0000-0000000000a3";
const HOST = "localhost:4000";
const PREFIX = "demo-ins";
const TRAININGS = [
  { title: "Angebote anlegen in 3 Schritten", topics: ["Angebot erstellen"] },
  { title: "Zahlungsziele und Abrechnungs-Einstellungen", topics: ["Standard-Zahlungsziel ändern"] },
];

const args = new Set(process.argv.slice(2));
const withMembers = !args.has("--no-members");
const withTrainings = args.has("--with-trainings");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url ?? "")) {
  console.error(`Refusing to seed a non-local Supabase (${url}).`);
  process.exit(1);
}
const db = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

const app = must(await db.from("apps").select("id").eq("id", APP_ID).eq("org_id", ORG_ID).maybeSingle(), "app");
if (!app) {
  console.error("Kundenwerk app not found — run `npm run seed:dev-org -w @lotse/server` first.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// People: 7 Vertrieb, 6 Buchhaltung, 2 Admin (Admin = group below 5 → never visible on its own)
// ---------------------------------------------------------------------------
const ROLES = [...Array(7).fill("Vertrieb"), ...Array(6).fill("Buchhaltung"), ...Array(2).fill("Admin")];
const people = ROLES.map((role, i) => {
  const nn = String(i + 1).padStart(2, "0");
  return { i, role, id: `d0000000-0000-0000-0000-0000000000${nn}`, email: `kolleg-${nn}@demo.test`, sid: `${PREFIX}-p${nn}` };
});
const subjectOf = (p) => (withMembers ? `u:${p.id}` : `s:${p.sid}`);

if (withMembers) {
  let created = 0;
  for (const p of people) {
    const found = await db.auth.admin.getUserById(p.id);
    if (!found.data?.user) {
      must(
        await db.auth.admin.createUser({
          id: p.id,
          email: p.email,
          password: randomUUID(), // synthetic account, nobody logs in with it
          email_confirm: true,
          user_metadata: { name: `Demo-Kolleg:in ${p.i + 1} (synthetisch)` },
        }),
        `create ${p.email}`,
      );
      created += 1;
    }
  }
  must(
    await db.from("org_members").upsert(
      people.map((p) => ({ org_id: ORG_ID, user_id: p.id, role: p.role, is_admin: false, email: p.email })),
      { onConflict: "org_id,user_id", ignoreDuplicates: true },
    ),
    "org_members",
  );
  console.log(`members: ${people.length} synthetic colleagues (${created} created), roles Vertrieb/Buchhaltung/Admin`);
}

if (withTrainings) {
  const have = new Set(must(await db.from("training_catalog").select("title").eq("org_id", ORG_ID), "trainings").map((t) => t.title));
  const missing = TRAININGS.filter((t) => !have.has(t.title));
  if (missing.length) must(await db.from("training_catalog").insert(missing.map((t) => ({ org_id: ORG_ID, ...t }))), "insert trainings");
  console.log(`trainings: ${missing.length} added, ${TRAININGS.length - missing.length} existed`);
}

// ---------------------------------------------------------------------------
// Synthetic timeline: the 10 days before today (UTC), deterministic → same rows on every run of the same day
// ---------------------------------------------------------------------------
let seed = 42;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const DAY = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10)).getTime();

const events = [];
const offers = [];
const feedback = [];
const thresholds = new Map();
const DELTA = { up: -0.02, down: 0.05, declined: 0.02 };
const ROLE_OF = { click: "button", search: "searchbox", focus: "textbox", idle: "textbox", submit: "form" };

/** One working session of a person; ev() appends an event a few seconds after the previous one. */
function session(p) {
  let t = today - int(1, 10) * DAY + int(8, 16) * 3_600_000 + int(0, 50) * 60_000;
  const ev = (type, route, label, detail, gapSec = int(3, 15)) => {
    t += gapSec * 1000;
    events.push({
      ts: new Date(t).toISOString(),
      type,
      route,
      element_role: label ? (ROLE_OF[type] ?? null) : null,
      element_label: label ?? null,
      detail: detail ?? null,
      session_id: p.sid,
      user_id: withMembers ? p.id : null,
      app_id: HOST,
    });
  };
  const offer = (intent, fb) => {
    t += 5_000;
    const offerId = `${PREFIX}-offer-${String(offers.length + 1).padStart(3, "0")}`;
    const subject = subjectOf(p);
    const before = thresholds.get(subject) ?? 0.8;
    offers.push({
      offer_id: offerId,
      subject_id: subject,
      app_id: HOST,
      intent,
      confidence: Math.round((0.82 + rnd() * 0.15) * 100) / 100,
      threshold: before,
      created_at: new Date(t).toISOString(),
    });
    if (fb) {
      const after = Math.round(Math.min(0.95, Math.max(0.6, before + DELTA[fb])) * 100) / 100;
      thresholds.set(subject, after);
      feedback.push({ offer_id: offerId, subject_id: subject, feedback: fb, threshold_before: before, threshold_after: after, created_at: new Date(t + 20_000).toISOString() });
    }
    t += 30_000;
  };
  return { ev, offer };
}

const V = people.filter((p) => p.role === "Vertrieb");
const B = people.filter((p) => p.role === "Buchhaltung");
const A = people.filter((p) => p.role === "Admin");

// Kunden suchen und filtern — everyone, 3 with empty results (ok)
for (const p of people) {
  const { ev } = session(p);
  ev("route", "/kunden.html");
  const empty = [2, 9, 12].includes(p.i);
  ev("search", "/kunden.html", "Kunden durchsuchen", `searchLength=${int(4, 9)};results=${empty ? 0 : int(1, 6)}`);
  if (empty) {
    ev("search", "/kunden.html", "Kunden durchsuchen", `searchLength=${int(4, 9)};results=0`);
    ev("empty_results", "/kunden.html", "Kunden durchsuchen", "results=0");
  }
  ev("click", "/kunden.html", "Status");
}

// Angebot erstellen — Vertrieb + Admin; Vertrieb gets stuck at the line items, the hint helps (→ Schulung)
const ANGEBOT = "Angebot erstellen";
const angebotFb = { 0: "up", 1: "up", 3: "up", 4: "down", 6: null };
for (const p of [...V, ...A]) {
  const { ev, offer } = session(p);
  ev("route", "/angebote.html");
  ev("click", "/angebote.html", "Angebot erstellen");
  ev("focus", "/angebote.html", "Kunde");
  ev("focus", "/angebote.html", "Titel");
  ev("click", "/angebote.html", "Weiter");
  if (p.i in angebotFb) {
    if (p.i === 0) ev("rage_click", "/angebote.html", "Weiter", "clicks=5");
    else {
      ev("focus", "/angebote.html", "Einzelpreis (€)");
      ev("idle", "/angebote.html", "Einzelpreis (€)", `idleSec=${int(60, 140)}`, 90);
    }
    offer(ANGEBOT, angebotFb[p.i]);
    if (p.i === 4) {
      ev("idle", "/angebote.html", "Einzelpreis (€)", `idleSec=${int(60, 140)}`, 80); // still stuck after the hint
      ev("route", "/dashboard.html");
      continue;
    }
  } else if (p.i === 5 || p.i === 14) {
    ev("route", "/dashboard.html"); // left without a stuck signal
    continue;
  }
  ev("focus", "/angebote.html", "Beschreibung");
  ev("focus", "/angebote.html", "Menge");
  ev("focus", "/angebote.html", "Einzelpreis (€)");
  ev("click", "/angebote.html", "Weiter");
  ev("click", "/angebote.html", "Angebot speichern");
  ev("submit", "/angebote.html", "Angebot speichern");
}

// Bankverbindung (IBAN) ändern — Buchhaltung + Admin; validation error, the hint does not help (→ App verbessern)
const IBAN = "Bankverbindung (IBAN) eines Kunden ändern";
const ibanFb = { 7: "down", 8: "down", 9: "up", 10: "down", 11: null, 13: "up" };
const ibanStillStuck = new Set([7, 8, 10, 11]);
for (const p of [...B, ...A]) {
  const { ev, offer } = session(p);
  const route = `/kunde.html?id=K-${1000 + int(1, 40)}`;
  ev("route", route);
  ev("click", route, "Zahlungsdaten");
  ev("click", route, "Bankverbindung bearbeiten");
  ev("focus", route, "IBAN");
  ev("click", route, "Speichern");
  if (p.i in ibanFb) {
    ev("error", route, "IBAN", "IBAN ungültig", 1);
    ev("rage_click", route, "Speichern", "clicks=4");
    offer(IBAN, ibanFb[p.i]);
    ev("focus", route, "IBAN");
    ev("click", route, "Speichern");
    if (ibanStillStuck.has(p.i)) {
      ev("error", route, "IBAN", "IBAN ungültig", 1);
      ev("route", "/kunden.html");
      continue;
    }
  }
  ev("submit", route, "Speichern", undefined, 1);
}

// Standard-Zahlungsziel ändern — Buchhaltung + Admin search for it in the global search (finds no settings),
// the hint helps (→ Schulung + UX: hard to find)
const ZIEL = "Standard-Zahlungsziel ändern";
const zielFb = { 7: "up", 8: "up", 9: "declined", 10: "up", 11: "up", 12: null, 13: "up" };
for (const p of [...B, ...A]) {
  const { ev, offer } = session(p);
  const page = int(0, 1) ? "/kunden.html" : "/dashboard.html";
  if (p.i in zielFb) {
    for (let k = 0; k < (p.i === 9 ? 3 : 2); k++) {
      ev("search", page, "Globale Suche", `searchLength=${int(9, 14)};results=0;matchedFeature=${ZIEL}`);
    }
    ev("route", "/einstellungen.html");
    ev("click", "/einstellungen.html", "Abrechnung");
    ev("idle", "/einstellungen.html", undefined, `idleSec=${int(40, 90)}`, 60);
    offer(ZIEL, zielFb[p.i]);
    if (p.i === 9) {
      ev("route", "/dashboard.html"); // declined the help and gave up
      continue;
    }
    if (p.i === 11) ev("idle", "/einstellungen.html", "Erweitert", `idleSec=${int(40, 80)}`, 50); // stuck again, then finds it
  } else {
    ev("route", "/einstellungen.html");
    ev("click", "/einstellungen.html", "Abrechnung");
  }
  ev("click", "/einstellungen.html", "Erweitert");
  ev("click", "/einstellungen.html", "Standard-Zahlungsziel ändern");
  ev("focus", "/einstellungen.html", "Neues Standard-Zahlungsziel (Tage)");
  ev("click", "/einstellungen.html", "Übernehmen");
  ev("submit", "/einstellungen.html", "Übernehmen", undefined, 1);
}

// Neue Aufgabe anlegen — Vertrieb + Buchhaltung, runs smoothly (→ Läuft)
for (const p of [...V, ...B]) {
  const { ev } = session(p);
  ev("route", "/aufgaben.html");
  ev("click", "/aufgaben.html", "Neue Aufgabe");
  ev("focus", "/aufgaben.html", "Titel");
  ev("focus", "/aufgaben.html", "Kunde");
  ev("focus", "/aufgaben.html", "Fällig am");
  if (p.i === 2) ev("rage_click", "/aufgaben.html", "Fällig am", "clicks=4");
  ev("click", "/aufgaben.html", "Aufgabe speichern");
  ev("submit", "/aufgaben.html", "Aufgabe speichern", undefined, 1);
}

// Notiz hinzufügen — only 3 persons → below the minimum group, must stay invisible
for (const p of [people[0], people[2], people[5]]) {
  const { ev } = session(p);
  const route = `/kunde.html?id=K-${1000 + int(1, 40)}`;
  ev("route", route);
  ev("click", route, "Verlauf");
  ev("click", route, "Neue Notiz");
  ev("rage_click", route, "Notiz speichern", "clicks=3");
  ev("submit", route, "Notiz speichern");
}

// Two offers without a clear goal → intent "(unklar)", 2 persons → not listed
for (const p of [people[3], people[8]]) {
  const { ev, offer } = session(p);
  ev("route", "/dashboard.html");
  ev("click", "/dashboard.html", "Kunden");
  ev("route", "/kunden.html");
  ev("route", "/dashboard.html");
  offer("Wie komme ich auf dieser Seite weiter?", "declined");
}

// ---------------------------------------------------------------------------
// Write: offers + feedback (ignore existing ids), events only if this seed's sessions have none yet
// ---------------------------------------------------------------------------
must(await db.from("lotse_offers").upsert(offers, { onConflict: "offer_id", ignoreDuplicates: true }), "offers");
must(await db.from("lotse_offer_feedback").upsert(feedback, { onConflict: "offer_id", ignoreDuplicates: true }), "feedback");

const existing = await db.from("lotse_events").select("id", { count: "exact", head: true }).eq("app_id", HOST).like("session_id", `${PREFIX}-%`);
if (existing.error) throw new Error(`events check: ${existing.error.message}`);
if (existing.count) {
  console.log(`events: ${existing.count} synthetic events already present — skipped`);
} else {
  for (let i = 0; i < events.length; i += 500) must(await db.from("lotse_events").insert(events.slice(i, i + 500)), "events");
  console.log(`events: ${events.length} inserted`);
}
console.log(`offers: ${offers.length}, feedback: ${feedback.length} (existing ids left untouched) · app ${HOST} · org ${ORG_ID}`);
console.log("Next: curl -s -X POST http://localhost:3001/api/insights/generate");
