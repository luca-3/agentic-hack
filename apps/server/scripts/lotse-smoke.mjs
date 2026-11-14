// Smoke test for the Lotse runtime against a running dev server: `npm run smoke -w @lotse/server`
// (server: `npm run dev:server`, port 3001; override with LOTSE_URL). Scenarios from demo-crm/SCENARIOS.md.
// Prints time-to-first-event (after `tier`) and total per case; exits 1 if an expectation fails.

const BASE = process.env.LOTSE_URL ?? "http://localhost:3001";
const SESSION = `smoke-${Date.now().toString(36)}`; // fresh pseudonymous subject → threshold starts at 0.8
const CRM = "http://localhost:4000";

const el = (number, role, label, route) => ({ number, role, label, route });
const shell = (route, admin = false) => [
  el(1, "link", "Dashboard", route),
  el(2, "link", "Kunden", route),
  el(3, "link", "Aufgaben", route),
  el(4, "link", "Angebote", route),
  ...(admin ? [el(5, "link", "Einstellungen", route)] : []),
  el(6, "searchbox", "Globale Suche", route),
  el(11, "button", "Suchen", route),
  el(12, "combobox", "Rolle", route),
  el(13, "button", "Hilfe", route),
  el(14, "link", "Demo-Daten zurücksetzen", route),
];

const customerPage = (id, name) => {
  const route = `/kunde.html?id=${id}`;
  return {
    url: `${CRM}${route}`,
    title: `${name} – Kundenwerk CRM`,
    capturedAt: Date.now(),
    elements: [
      ...shell(route),
      el(20, "link", "Zurück zur Kundenliste", route),
      el(21, "link", "Aufgabe anlegen", route),
      el(22, "tab", "Übersicht", route),
      el(23, "tab", "Ansprechpartner", route),
      el(24, "tab", "Zahlungsdaten", route),
      el(25, "tab", "Verlauf", route),
    ],
  };
};

const dashboardPage = {
  url: `${CRM}/index.html`,
  title: "Dashboard – Kundenwerk CRM",
  capturedAt: Date.now(),
  elements: [
    ...shell("/index.html"),
    el(30, "link", "Neue Aufgabe", "/index.html"),
    el(31, "link", "Alle Aufgaben anzeigen", "/index.html"),
    el(32, "link", "Zu den Angeboten", "/index.html"),
    el(33, "checkbox", "Erledigt: Angebot nachfassen", "/index.html"),
    el(34, "link", "Müller Logistik GmbH", "/index.html"),
  ],
};

// Scenario 10: offer ANG-2026-044 (Becker, status "Zur Freigabe") — "Freigeben" only for Vertriebsleitung/Admin.
const offerPage = (() => {
  const route = "/angebot.html?id=o8";
  return {
    url: `${CRM}${route}`,
    title: "ANG-2026-044 – Kundenwerk CRM",
    capturedAt: Date.now(),
    elements: [
      ...shell(route),
      el(40, "button", "Freigeben", route),
      el(41, "button", "Versenden", route),
      el(42, "button", "Aktionen", route),
      el(43, "link", "Becker Maschinenbau AG", route),
    ],
  };
})();

const headers = (extra = {}) => ({
  "content-type": "application/json",
  "x-lotse-session": SESSION,
  "x-lotse-app": "localhost:4000",
  ...extra,
});

let context; // x-lotse-context of the first /ask (knowledge source, org found, role source)
async function ask(body) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/lotse/ask`, {
    method: "POST",
    headers: headers({ accept: "application/x-ndjson" }),
    body: JSON.stringify(body),
  });
  const events = [];
  let firstMs;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type !== "tier" && firstMs === undefined) firstMs = performance.now() - t0;
      events.push(ev);
    }
  }
  context ??= res.headers.get("x-lotse-context");
  return { status: res.status, events, firstMs, totalMs: performance.now() - t0 };
}

let failed = 0;
function report(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}\n    ${detail}`);
}
const ms = (n) => (n === undefined ? "–" : `${Math.round(n)} ms`);
const short = (events) => events.map((e) => JSON.stringify(e)).join("\n    ");

// (a) IBAN on customer detail → point at "Zahlungsdaten", no say
{
  const r = await ask({ question: "Wo ändere ich die IBAN?", role: "Buchhaltung", snapshot: customerPage("mueller-logistik", "Müller Logistik GmbH") });
  const point = r.events.find((e) => e.type === "point");
  const ok = point?.label === "Zahlungsdaten" && !r.events.some((e) => e.type === "say") && r.events.at(-1)?.type === "done";
  report("(a) IBAN → point Zahlungsdaten, no say", ok, `first ${ms(r.firstMs)} · total ${ms(r.totalMs)}\n    ${short(r.events)}`);
}

// (b) "Wie lege ich eine Aufgabe an?" from the dashboard → plan
{
  const r = await ask({ question: "Wie lege ich eine Aufgabe an?", role: "Vertrieb", snapshot: dashboardPage });
  const plan = r.events.find((e) => e.type === "plan");
  const ok = !!plan && plan.steps.length >= 2 && r.events.at(-1)?.type === "done";
  report("(b) Aufgabe anlegen → plan", ok, `first ${ms(r.firstMs)} · total ${ms(r.totalMs)}\n    ${short(r.events)}`);
}

// (c) role Vertrieb wants to edit Zahlungsdaten → short say naming Buchhaltung/Admin, no path
{
  const r = await ask({
    question: "Wie ändere ich die Bankverbindung von Weber Elektrotechnik?",
    role: "Vertrieb",
    snapshot: customerPage("weber-elektrotechnik", "Weber Elektrotechnik"),
  });
  const say = r.events.find((e) => e.type === "say");
  const ok = !!say && /buchhaltung|admin/i.test(say.text) && say.text.length <= 200 && !r.events.some((e) => e.type === "plan");
  report("(c) Vertrieb + Zahlungsdaten → say Buchhaltung/Admin", ok, `first ${ms(r.firstMs)} · total ${ms(r.totalMs)}\n    ${short(r.events)}`);
}

// (i) scenario 10, role Vertrieb wants to approve an offer → say naming Vertriebsleitung/Admin, no path
{
  const r = await ask({ question: "Wie gebe ich das Angebot für Becker frei?", role: "Vertrieb", snapshot: offerPage });
  const say = r.events.find((e) => e.type === "say");
  const ok = !!say && /vertriebsleitung|admin/i.test(say.text) && !r.events.some((e) => e.type === "plan" || e.type === "point");
  report("(i) Vertrieb + Angebot freigeben → say Vertriebsleitung/Admin", ok, `first ${ms(r.firstMs)} · total ${ms(r.totalMs)}\n    ${short(r.events)}`);
}

// (j) scenario 10, role Vertriebsleitung → marks "Freigeben" (point, or plan whose step is Freigeben)
{
  const r = await ask({ question: "Wie gebe ich das Angebot für Becker frei?", role: "Vertriebsleitung", snapshot: offerPage });
  const point = r.events.find((e) => e.type === "point");
  const plan = r.events.find((e) => e.type === "plan");
  const ok = point?.label === "Freigeben" || !!plan?.steps.some((s) => s.label === "Freigeben");
  report("(j) Vertriebsleitung + Angebot freigeben → Freigeben", ok, `first ${ms(r.firstMs)} · total ${ms(r.totalMs)}\n    ${short(r.events)}`);
}

// (d) decide: 3 empty searches → intervene (Decisions API), with offerId + threshold
const now = Date.now();
const searches = [0, 1, 2].map((i) => ({
  type: "search",
  route: "/kunde.html?id=mueller-logistik",
  elementRole: "searchbox",
  elementLabel: "Globale Suche",
  detail: "results=0;searchLength=4",
  ts: now - (3 - i) * 8000,
}));
async function decideOnce() {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/lotse/decide`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      trigger: "repeated_search",
      events: searches,
      snapshot: customerPage("mueller-logistik", "Müller Logistik GmbH"),
      role: "Buchhaltung",
    }),
  });
  return { status: res.status, body: await res.json(), ms: performance.now() - t0 };
}
const d1 = await decideOnce();
const d2 = await decideOnce();
report(
  "(d) decide 3× empty search → intervene",
  d1.status === 200 && d1.body.intervene === true && !!d1.body.offerId && d1.body.threshold === 0.8,
  `${ms(d1.ms)} / ${ms(d2.ms)}\n    ${JSON.stringify(d1.body)}`,
);

// (e) adaptive threshold: feedback down on two offers → 0.9; repeated feedback on the same offer counts once
{
  const fb = async (offerId, feedback) =>
    (await fetch(`${BASE}/api/lotse/feedback`, { method: "POST", headers: headers(), body: JSON.stringify({ offerId, feedback }) })).json();
  const a = await fb(d1.body.offerId, "down");
  const b = await fb(d1.body.offerId, "down"); // idempotent
  const c = d2.body.offerId ? await fb(d2.body.offerId, "down") : { proactiveThreshold: NaN };
  const prefs = await (await fetch(`${BASE}/api/lotse/prefs`, { headers: headers() })).json();
  const unknown = await fetch(`${BASE}/api/lotse/feedback`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ offerId: "does-not-exist", feedback: "up" }),
  });
  report(
    "(e) feedback down ×2 → prefs 0.9 (idempotent, unknown → 404)",
    a.proactiveThreshold === 0.85 && b.proactiveThreshold === 0.85 && c.proactiveThreshold === 0.9 && prefs.proactiveThreshold === 0.9 && unknown.status === 404,
    `after down #1 ${a.proactiveThreshold} · repeat ${b.proactiveThreshold} · down #2 ${c.proactiveThreshold} · GET prefs ${prefs.proactiveThreshold} · unknown ${unknown.status}`,
  );
}

// (f) legacy JSON response (no Accept: ndjson) for the walking-skeleton extension
{
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/lotse/ask`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ question: "Wo sehe ich die Ansprechpartner?", snapshot: customerPage("mueller-logistik", "Müller Logistik GmbH") }),
  });
  const body = await res.json();
  report("(f) legacy JSON {elementNumber, sentence}", res.status === 200 && body.elementNumber === 23, `${ms(performance.now() - t0)} · ${JSON.stringify(body)}`);
}

// (g) events ingest → 202
{
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/lotse/events`, { method: "POST", headers: headers(), body: JSON.stringify({ appId: "localhost:4000", events: searches }) });
  report("(g) events batch → 202", res.status === 202, `${ms(performance.now() - t0)} · ${JSON.stringify(await res.json())}`);
}

// (h) bad request → 400 error event
{
  const r = await ask({ question: "", snapshot: dashboardPage });
  report("(h) invalid body → 400 + error event", r.status === 400 && r.events[0]?.type === "error" && r.events[0].code === "bad_request", `${r.status} ${short(r.events).slice(0, 160)}`);
}

console.log(`\ncontext: ${context ?? "(no x-lotse-context header — server older than this script?)"}`);
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
