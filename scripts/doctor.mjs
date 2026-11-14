// Checks that this machine is ready to work on the project: `npm run doctor`.
// Read-only: it never starts, stops or changes anything.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

let failed = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const warn = (msg, fix) => console.log(`⚠ ${msg}${fix ? `\n    → ${fix}` : ""}`);
const fail = (msg, fix) => {
  failed++;
  console.log(`✗ ${msg}${fix ? `\n    → ${fix}` : ""}`);
};
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// --- Tools -------------------------------------------------------------
const nodeMajor = Number(process.versions.node.split(".")[0]);
nodeMajor >= 22 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old`, "Install Node 22+ (https://nodejs.org)");

existsSync("node_modules/next") ? ok("Dependencies installed") : fail("Dependencies missing", "npm install");

try {
  const mem = Number(sh("docker", ["info", "--format", "{{.MemTotal}}"]));
  const gib = (mem / 1024 ** 3).toFixed(1);
  mem >= 3.5 * 1024 ** 3
    ? ok(`Docker running (${gib} GiB memory)`)
    : warn(`Docker has only ${gib} GiB memory`, "Give Docker ≥ 4 GiB (Docker Desktop: Settings → Resources; Colima: colima start --memory 6)");
} catch {
  fail("Docker is not running", "Start Docker Desktop / OrbStack / Colima");
}

let supabaseCli = false;
try {
  ok(`Supabase CLI ${sh("supabase", ["--version"])}`);
  supabaseCli = true;
} catch {
  fail("Supabase CLI missing", "brew install supabase/tap/supabase  (Windows: scoop install supabase)");
}

// --- Local Supabase ----------------------------------------------------
if (supabaseCli) {
  try {
    const status = JSON.parse(sh("supabase", ["status", "-o", "json"]));
    ok(`Local Supabase running (${status.API_URL}, Studio ${status.STUDIO_URL ?? "-"})`);
  } catch {
    fail("Local Supabase is not running", "npm run db:start   (port conflict? see SETUP.md → Troubleshooting)");
  }
}

// --- .env.local --------------------------------------------------------
if (!existsSync(".env.local")) {
  fail(".env.local missing", "npm run db:env   then paste GEMINI_API_KEY into .env.local");
} else {
  process.loadEnvFile(".env.local");
  const required = {
    NEXT_PUBLIC_SUPABASE_URL: "npm run db:env",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "npm run db:env",
    SUPABASE_SECRET_KEY: "npm run db:env",
    GEMINI_API_KEY: "Paste the team key into .env.local (ask in the team chat, never commit it)",
  };
  const missing = Object.keys(required).filter((k) => !process.env[k]);
  missing.length === 0
    ? ok(".env.local has all required variables")
    : missing.forEach((k) => fail(`${k} is empty in .env.local`, required[k]));

  // --- Live checks -----------------------------------------------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/notes?select=id&limit=1`, { headers: { apikey: key } });
      res.ok
        ? ok("Database reachable, migrations applied")
        : fail(`Database answered HTTP ${res.status}`, res.status === 404 ? "npm run db:reset (applies migrations + seed)" : "npm run db:env (keys may be stale)");
    } catch {
      fail(`Cannot reach Supabase at ${url}`, "npm run db:start, then npm run db:env");
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
      });
      res.ok ? ok("Gemini API key valid") : fail(`Gemini API key rejected (HTTP ${res.status})`, "Check the key in .env.local");
    } catch {
      warn("Could not reach the Gemini API (offline?)");
    }
  }
}

console.log(failed ? `\n${failed} problem(s) found.` : "\nAll good — start what you work on: `npm run dev:server` (http://localhost:3001), `npm run dev:dashboard` (http://localhost:3000), `npm run dev:extension`, `npm run demo:crm` (http://localhost:4000)");
process.exitCode = failed ? 1 : 0;
