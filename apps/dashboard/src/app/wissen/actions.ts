"use server";
import { KNOWLEDGE_LIMITS, LOTSE_DEFAULTS } from "@lotse/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chunkText } from "@/lib/chunk";
import { requireAdmin } from "@/lib/org";

const MAX_BYTES = 200 * 1024;
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const fehler = (code: string): never => redirect(`/wissen?fehler=${code}`);

/** Saves a knowledge source, chunks it and lets the server embed it. Rolls the source back if indexing fails. */
export async function wissenHinzufuegen(fd: FormData) {
  const { supabase, orgId } = await requireAdmin();
  const datei = fd.get("datei");
  const hatDatei = datei instanceof File && datei.size > 0;
  if (hatDatei && datei.size > MAX_BYTES) fehler("gross");
  const inhalt = hatDatei ? (await datei.text()).trim() : text(fd, "text");
  if (new TextEncoder().encode(inhalt).length > MAX_BYTES) fehler("gross");
  const title = text(fd, "title") || (hatDatei ? datei.name : "");
  if (!title) fehler("titel");

  const alle = chunkText(inhalt);
  if (!alle.length) fehler("leer");
  const chunks = alle.slice(0, KNOWLEDGE_LIMITS.maxChunks);

  const { data: source, error } = await supabase
    .from("knowledge_sources")
    .insert({
      org_id: orgId,
      app_id: text(fd, "appId") || null,
      title,
      kind: (hatDatei && datei.name.toLowerCase().endsWith(".md")) || inhalt.includes("#") ? "markdown" : "text",
      // chars/chunks stay 0 here — the server's ingest counts what it actually embedded
    })
    .select("id")
    .single();
  if (error || !source) fehler("speichern");

  const token = (await supabase.auth.getSession()).data.session?.access_token;
  let ok = false;
  try {
    const res = await fetch(`${process.env.LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl}/api/knowledge/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sourceId: source!.id, chunks }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    await supabase.from("knowledge_sources").delete().eq("id", source!.id);
    fehler("server");
  }

  revalidatePath("/wissen");
  redirect(`/wissen?ok=${chunks.length}${alle.length > chunks.length ? `&gekuerzt=${alle.length}` : ""}`);
}

/** Deleting the source cascades to its embedded chunks (documents.source_id on delete cascade). */
export async function wissenLoeschen(fd: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("knowledge_sources").delete().eq("id", text(fd, "id"));
  if (error) throw new Error(error.message);
  revalidatePath("/wissen");
}
