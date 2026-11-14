"use server";
import { FeatureSchema, KNOWLEDGE_LIMITS, LOTSE_DEFAULTS, LearnResponseSchema } from "@lotse/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chunkText } from "@/lib/chunk";
import { requireAdmin, type OrgContext } from "@/lib/org";

const MAX_BYTES = 200 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;
const STATUS = ["open", "accepted", "dismissed"];
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const serverUrl = () => process.env.LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl;
const token = async (ctx: OrgContext) => (await ctx.supabase.auth.getSession()).data.session?.access_token;

/** Back to /learning with the current filters (hidden fields app/status) plus a message. */
function zurueck(fd: FormData, meldung: Record<string, string>): never {
  const q = new URLSearchParams(meldung);
  const app = text(fd, "app");
  const status = text(fd, "status");
  if (UUID.test(app)) q.set("app", app);
  if (STATUS.includes(status)) q.set("status", status);
  revalidatePath("/learning");
  redirect(`/learning?${q}`);
}

async function vorschlag(ctx: OrgContext, fd: FormData) {
  const id = Number(text(fd, "id"));
  if (!Number.isInteger(id)) return null;
  const { data } = await ctx.supabase
    .from("lotse_suggestions")
    .select("id, app_id, kind, title, payload")
    .eq("id", id)
    .maybeSingle();
  return data as { id: number; app_id: string | null; kind: string; title: string; payload: Record<string, unknown> } | null;
}

async function statusSetzen(ctx: OrgContext, id: number, status: "accepted" | "dismissed") {
  // RLS: only admins of the suggestion's org can update.
  const { error } = await ctx.supabase
    .from("lotse_suggestions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

/** "Analyze now": lets the server run the learning detectors for this org (optionally one app). */
export async function auswerten(fd: FormData) {
  const ctx = await requireAdmin();
  const app = text(fd, "app");
  let ergebnis;
  try {
    const res = await fetch(`${serverUrl()}/api/lotse/learn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(ctx)}` },
      body: JSON.stringify(UUID.test(app) ? { appId: app } : {}),
      cache: "no-store",
    });
    if (res.ok) ergebnis = LearnResponseSchema.safeParse(await res.json()).data;
  } catch {
    ergebnis = undefined;
  }
  if (!ergebnis) zurueck(fd, { error: "server" });
  zurueck(fd, { suggestions: String(ergebnis.suggestions), insights: String(ergebnis.insights) });
}

export async function erledigen(fd: FormData) {
  const ctx = await requireAdmin();
  zurueck(fd, (await statusSetzen(ctx, Number(text(fd, "id")), "accepted")) ? { ok: "done" } : { error: "save" });
}

export async function verwerfen(fd: FormData) {
  const ctx = await requireAdmin();
  zurueck(fd, (await statusSetzen(ctx, Number(text(fd, "id")), "dismissed")) ? { ok: "dismissed" } : { error: "save" });
}

/** Feature suggestion → app_features row (skipped if the same route + name already exists), then accepted. */
export async function funktionUebernehmen(fd: FormData) {
  const ctx = await requireAdmin();
  const v = await vorschlag(ctx, fd);
  if (!v || v.kind !== "feature" || !v.app_id) zurueck(fd, { error: "format" });
  const parsed = FeatureSchema.safeParse(v.payload);
  if (!parsed.success) zurueck(fd, { error: "format" });
  const f = parsed.data;

  const { data: vorhanden } = await ctx.supabase
    .from("app_features")
    .select("id")
    .eq("app_id", v.app_id)
    .eq("route", f.route)
    .eq("name", f.name)
    .limit(1);
  if (!vorhanden?.length) {
    const { error } = await ctx.supabase.from("app_features").insert({
      app_id: v.app_id,
      name: f.name,
      description: f.description,
      route: f.route,
      click_path: f.clickPath,
      required_roles: f.requiredRole?.length ? f.requiredRole : null,
    });
    if (error) zurueck(fd, { error: "save" });
  }
  if (!(await statusSetzen(ctx, v.id, "accepted"))) zurueck(fd, { error: "save" });
  revalidatePath("/apps");
  zurueck(fd, { ok: vorhanden?.length ? "feature-exists" : "feature" });
}

/** Knowledge gap → knowledge_sources row + server ingest (same flow as /knowledge), rollback on failure, then accepted. */
export async function wissenUebernehmen(fd: FormData) {
  const ctx = await requireAdmin();
  const v = await vorschlag(ctx, fd);
  if (!v || v.kind !== "knowledge_gap") zurueck(fd, { error: "format" });
  const inhalt = text(fd, "text");
  if (new TextEncoder().encode(inhalt).length > MAX_BYTES) zurueck(fd, { error: "too-large" });
  const chunks = chunkText(inhalt).slice(0, KNOWLEDGE_LIMITS.maxChunks);
  if (!chunks.length) zurueck(fd, { error: "empty" });
  const topic = typeof v.payload.topic === "string" && v.payload.topic.trim() ? v.payload.topic.trim() : v.title;

  const { data: source, error } = await ctx.supabase
    .from("knowledge_sources")
    .insert({ org_id: ctx.orgId, app_id: v.app_id, title: topic, kind: inhalt.includes("#") ? "markdown" : "text" })
    .select("id")
    .single();
  if (error || !source) zurueck(fd, { error: "save" });

  let ok = false;
  try {
    const res = await fetch(`${serverUrl()}/api/knowledge/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(ctx)}` },
      body: JSON.stringify({ sourceId: source.id, chunks }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    await ctx.supabase.from("knowledge_sources").delete().eq("id", source.id);
    zurueck(fd, { error: "server-knowledge" });
  }
  await statusSetzen(ctx, v.id, "accepted");
  revalidatePath("/knowledge");
  zurueck(fd, { ok: "knowledge" });
}

/** Agent memory (D-28): approve or reject one entry via the server (it checks is_org_admin again). */
export async function gedaechtnisSetzen(fd: FormData) {
  const ctx = await requireAdmin();
  const action = text(fd, "action");
  const id = Number(text(fd, "id"));
  if ((action !== "approve" && action !== "reject") || !Number.isInteger(id) || id <= 0) zurueck(fd, { error: "format" });
  const app = text(fd, "app");
  let ok = false;
  try {
    const res = await fetch(`${serverUrl()}/api/lotse/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(ctx)}` },
      body: JSON.stringify({ action, id, ...(UUID.test(app) && { app }) }),
      cache: "no-store",
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  zurueck(fd, ok ? { ok: action === "approve" ? "memory-approved" : "memory-rejected" } : { error: "server" });
}
