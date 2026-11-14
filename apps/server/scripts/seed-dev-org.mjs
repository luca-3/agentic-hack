// Dev seed for the Lotse runtime's DB path — additive and idempotent, never deletes or overwrites anything.
//   node scripts/seed-dev-org.mjs                      org "Fuller GmbH (Demo)" + app "Kundenwerk CRM" (localhost:4000) + missing features
//   node scripts/seed-dev-org.mjs --with-user          + test user vertrieb@demo.test / demo1234 (role Vertrieb, org admin)
//   node scripts/seed-dev-org.mjs --with-knowledge     + knowledge/kundenwerk-crm-faq.md embedded via the running server (implies --with-user)
// Same ids as supabase/seeds/dashboard.sql, so a later `db reset` (which runs that seed) ends in the same org/app.
// Use it when the local DB is empty and a reset is not an option. Features: src/lib/lotse/fixtures/kundenwerk-features.json.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
process.loadEnvFile(path.join(root, ".env.local"));

const ORG = { id: "00000000-0000-0000-0000-0000000000f1", name: "Fuller GmbH (Demo)" };
const APP = { id: "00000000-0000-0000-0000-0000000000a3", org_id: ORG.id, name: "Kundenwerk CRM", domains: ["localhost:4000"] };
// Test account for the local dev stack only (same convention as supabase/seeds/dashboard.sql).
const USER = { id: "a0000000-0000-0000-0000-000000000004", email: "vertrieb@demo.test", password: "demo1234", role: "Vertrieb" };
const KNOWLEDGE = { title: "Kundenwerk CRM – FAQ (Dev-Seed)", file: path.join(root, "knowledge/kundenwerk-crm-faq.md") };
const SERVER = process.env.LOTSE_URL ?? "http://localhost:3001";

const args = new Set(process.argv.slice(2));
const withKnowledge = args.has("--with-knowledge");
const withUser = withKnowledge || args.has("--with-user");

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

// 1. Org + app (insert only if missing; an existing localhost:4000 app of someone else is left alone)
must(await db.from("orgs").upsert(ORG, { onConflict: "id", ignoreDuplicates: true }), "org");
const existing = must(await db.from("apps").select("id, name").contains("domains", ["localhost:4000"]), "apps");
const other = existing.find((a) => a.id !== APP.id);
if (other) {
  console.log(`An app for localhost:4000 already exists (${other.name}, ${other.id}) — not touching it.`);
  process.exit(0);
}
must(await db.from("apps").upsert(APP, { onConflict: "id", ignoreDuplicates: true }), "app");

// 2. Features: insert the ones whose name is not there yet
const features = JSON.parse(readFileSync(path.join(here, "../src/lib/lotse/fixtures/kundenwerk-features.json"), "utf8"));
const have = new Set(must(await db.from("app_features").select("name").eq("app_id", APP.id), "features").map((r) => r.name));
const missing = features.filter((f) => !have.has(f.name));
if (missing.length) {
  must(
    await db.from("app_features").insert(
      missing.map((f) => ({
        app_id: APP.id,
        name: f.name,
        route: f.route,
        click_path: f.clickPath,
        description: f.description ?? null,
        required_roles: f.requiredRole ?? null,
      })),
    ),
    "insert features",
  );
}
console.log(`org ${ORG.name} · app ${APP.name} (${APP.domains}) · features: ${have.size} existing, ${missing.length} added`);

// 3. Optional test user + membership
if (withUser) {
  const found = await db.auth.admin.getUserById(USER.id);
  if (!found.data?.user) {
    must(
      await db.auth.admin.createUser({ id: USER.id, email: USER.email, password: USER.password, email_confirm: true, user_metadata: { name: "Demo Vertrieb" } }),
      "create user",
    );
  }
  must(
    await db
      .from("org_members")
      .upsert({ org_id: ORG.id, user_id: USER.id, role: USER.role, is_admin: true, email: USER.email }, { onConflict: "org_id,user_id", ignoreDuplicates: true }),
    "membership",
  );
  console.log(`user ${USER.email} (role ${USER.role}, org admin) ${found.data?.user ? "existed" : "created"}`);
}

// 4. Optional knowledge base: one source, chunked on "## " headings, embedded by the server (Gemini stays server-side)
if (withKnowledge) {
  const sources = must(await db.from("knowledge_sources").select("id, chunks").eq("org_id", ORG.id).eq("title", KNOWLEDGE.title), "sources");
  if (sources.some((s) => s.chunks > 0)) {
    console.log(`knowledge "${KNOWLEDGE.title}" already embedded — skipped`);
  } else {
    const source =
      sources[0] ??
      must(await db.from("knowledge_sources").insert({ org_id: ORG.id, app_id: APP.id, title: KNOWLEDGE.title, kind: "markdown" }).select("id").single(), "source");
    const md = readFileSync(KNOWLEDGE.file, "utf8");
    const title = md.match(/^# .+$/m)?.[0] ?? "";
    const chunks = md
      .split(/\n(?=## )/)
      .slice(1)
      .flatMap((part) => {
        const out = [];
        for (let rest = part.trim(); rest; rest = rest.slice(1800).trim()) out.push(`${title}\n${rest.slice(0, 1800)}`);
        return out;
      });
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const { session } = must(await anon.auth.signInWithPassword({ email: USER.email, password: USER.password }), "sign in");
    const res = await fetch(`${SERVER}/api/knowledge/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ sourceId: source.id, chunks }),
    });
    console.log(`knowledge "${KNOWLEDGE.title}": ${chunks.length} chunks → ${res.status} ${await res.text()}`);
  }
}
