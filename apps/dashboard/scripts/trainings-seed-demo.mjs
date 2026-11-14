// Demo trainings that come from employees' questions (Kundenwerk CRM, org "Fuller GmbH (Demo)") — invented aggregates.
// Local Supabase only; additive and idempotent: upsert by title (update if it exists, else insert), never deletes.
//   node apps/dashboard/scripts/trainings-seed-demo.mjs         write into the local DB
//   node apps/dashboard/scripts/trainings-seed-demo.mjs --sql   print the same rows as SQL (source of supabase/seeds/dashboard.sql)
// Backing = number of questions + distinct people in the last 30 days; below 5 people the dashboard hides it (D-12, D-28).
// Bundles: backing = distinct people across all parts (not the sum); bundle_of = part titles in teaching order.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "00000000-0000-0000-0000-0000000000f1";
const APP_ID = "00000000-0000-0000-0000-0000000000a3"; // Kundenwerk CRM
const IBAN = "Changing a customer's bank details (IBAN)";
const OFFER_SEND = "Submitting an offer for approval and sending it";

const base = { source: "questions", app_id: APP_ID, period_days: 30, bundle_of: [] };
const TRAININGS = [
  {
    ...base,
    title: IBAN,
    description:
      "Where bank details live: customer → tab „Zahlungsdaten“ → „Bankverbindung bearbeiten“ (IBAN, BIC, bank, account holder) and why an IBAN gets rejected. Stuck point: people type „IBAN“ into the global search, which finds customers but no functions.",
    topics: ["Bankverbindung (IBAN) eines Kunden ändern"],
    roles: ["Buchhaltung"],
    asked_count: 100,
    asked_by: 37,
  },
  {
    ...base,
    title: OFFER_SEND,
    description:
      "The status path „Entwurf“ → „Zur Freigabe“ → „Freigegeben“ → „Versendet“: save the line items, then „Zur Freigabe einreichen“; only Vertriebsleitung can „Freigeben“. Stuck point: „Versenden“ stays greyed out until the offer is approved.",
    topics: ["Angebot zur Freigabe einreichen", "Angebot freigeben", "Angebot versenden"],
    roles: ["Vertrieb", "Vertriebsleitung"],
    asked_count: 78,
    asked_by: 46,
  },
  {
    ...base,
    title: "Cancelling a contract incl. notice period",
    description:
      "Customer → tab „Verträge“ → „Vertrag kündigen“: pick a reason, choose a contract end that respects the notice period, confirm with „Endgültig kündigen“. Stuck point: the notice-period warning and the second confirmation dialog.",
    topics: ["Vertrag eines Kunden kündigen"],
    roles: ["Vertriebsleitung"],
    asked_count: 52,
    asked_by: 29,
  },
  {
    ...base,
    title: "Setting a deputy for your absence",
    description:
      "Before a holiday: user menu → „Mein Konto“ → „Abwesenheit“ → switch on „Ich bin abwesend“ → „Vertretung festlegen“ with dates and a colleague. Stuck point: it isn't in the sidebar – the command palette (Ctrl+K, „Vertretung“) gets there in one step.",
    topics: ["Vertretung für Abwesenheit festlegen", "Befehlspalette (Strg+K / ⌘K)"],
    roles: [],
    asked_count: 27,
    asked_by: 18,
  },
  {
    ...base,
    title: "Payment flow: bank details → payment terms → checking payment data",
    description:
      "One session on getting paid: update a customer's bank details, change the default payment term (hidden under „Einstellungen“ → „Abrechnung“ → „Erweitert“) and check the payment data before an offer goes out. Bundled because the same people ask about all three steps.",
    topics: ["Bankverbindung (IBAN) eines Kunden ändern", "Standard-Zahlungsziel ändern"],
    roles: ["Buchhaltung", "Admin"],
    asked_count: 141,
    asked_by: 52,
    bundle_of: [IBAN, "Changing the default payment term („Standard-Zahlungsziel“)", "Checking a customer's payment data („Zahlungsdaten“)"],
  },
  {
    ...base,
    title: "Offers end-to-end: create, discount, approve, send",
    description:
      "The whole offer path in one session: create an offer in three steps, add line items with a discount (only while „Entwurf“ – save before changing the status), submit it for approval and send it. Bundled because many who ask about sending got stuck one step earlier.",
    topics: ["Angebot erstellen", "Angebotspositionen mit Rabatt bearbeiten", "Angebot zur Freigabe einreichen", "Angebot freigeben", "Angebot versenden"],
    roles: ["Vertrieb", "Vertriebsleitung"],
    asked_count: 134,
    asked_by: 61,
    bundle_of: ["Creating an offer in 3 steps („Angebot erstellen“)", "Line items with a discount („Rabatt (%)“)", OFFER_SEND],
  },
];

const COLS = ["org_id", "title", "description", "topics", "source", "app_id", "roles", "asked_count", "asked_by", "period_days", "bundle_of"];

if (process.argv.includes("--sql")) {
  const lit = (v) =>
    typeof v === "number" ? String(v) : Array.isArray(v) ? `array[${v.map(lit).join(", ")}]::text[]` : `'${String(v).replaceAll("'", "''")}'`;
  const rows = TRAININGS.map((t) => `  (${COLS.map((c) => lit(c === "org_id" ? ORG_ID : t[c])).join(", ")})`);
  console.log(
    `-- Trainings from employees' questions, Kundenwerk CRM (invented aggregates, last 30 days; generated by\n` +
      `-- apps/dashboard/scripts/trainings-seed-demo.mjs --sql). Bundles: asked_by = distinct people across all parts.\n` +
      `insert into public.training_catalog (${COLS.join(", ")}) values\n${rows.join(",\n")};`,
  );
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.resolve(here, "../../../.env.local"));
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
  console.error("Kundenwerk app not found — run `npm run seed:dev-org -w @lotse/server` (or a db reset) first.");
  process.exit(1);
}

const existing = must(await db.from("training_catalog").select("id, title").eq("org_id", ORG_ID).in("title", TRAININGS.map((t) => t.title)), "read");
const idOf = new Map(existing.map((r) => [r.title, r.id]));
let updated = 0;
for (const t of TRAININGS.filter((t) => idOf.has(t.title))) {
  must(await db.from("training_catalog").update(t).eq("id", idOf.get(t.title)), `update ${t.title}`);
  updated += 1;
}
const missing = TRAININGS.filter((t) => !idOf.has(t.title)).map((t) => ({ org_id: ORG_ID, ...t }));
if (missing.length) must(await db.from("training_catalog").insert(missing), "insert");
console.log(`trainings from questions: ${missing.length} added, ${updated} updated (Kundenwerk CRM, org Fuller GmbH (Demo))`);
