"use server";
import { FeatureListSchema } from "@lotse/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/org";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const liste = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export async function anmelden(fd: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: text(fd, "email"), password: text(fd, "password") });
  if (error) redirect("/login?fehler=anmeldung");
  redirect("/");
}

export async function abmelden() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function appAnlegen(fd: FormData) {
  const { supabase, orgId } = await requireAdmin();
  const name = text(fd, "name");
  if (!name) return;
  const { error } = await supabase.from("apps").insert({ org_id: orgId, name, domains: liste(text(fd, "domains")) });
  if (error) throw new Error(error.message);
  revalidatePath("/apps");
}

export async function domainsSpeichern(fd: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("apps").update({ domains: liste(text(fd, "domains")) }).eq("id", text(fd, "appId"));
  if (error) throw new Error(error.message);
  revalidatePath("/apps");
}

/** Replaces the whole feature list of an app with pasted JSON (format of demo-crm/lotse-features.json). */
export async function funktionenImportieren(fd: FormData) {
  const { supabase } = await requireAdmin();
  const appId = text(fd, "appId");
  let parsed;
  try {
    parsed = FeatureListSchema.safeParse(JSON.parse(text(fd, "json")));
  } catch {
    redirect(`/apps?fehler=json&app=${appId}`);
  }
  if (!parsed.success) redirect(`/apps?fehler=format&app=${appId}`);

  // RLS (admins manage features) checks that the app belongs to the admin's org.
  const { error: delError } = await supabase.from("app_features").delete().eq("app_id", appId);
  if (delError) throw new Error(delError.message);
  const rows = parsed.data.map((f) => ({
    app_id: appId,
    name: f.name,
    description: f.description,
    route: f.route,
    click_path: f.clickPath,
    required_roles: f.requiredRole?.length ? f.requiredRole : null,
  }));
  if (rows.length) {
    const { error } = await supabase.from("app_features").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/apps");
  redirect(`/apps?ok=${rows.length}&app=${appId}`);
}

export async function schulungAnlegen(fd: FormData) {
  const { supabase, orgId } = await requireAdmin();
  const title = text(fd, "title");
  if (!title) return;
  const url = text(fd, "url") || null;
  const { error } = await supabase.from("training_catalog").insert({ org_id: orgId, title, topics: liste(text(fd, "topics")), url });
  if (error) throw new Error(error.message);
  revalidatePath("/trainings");
  revalidatePath("/insights");
}

export async function mitgliedSpeichern(fd: FormData) {
  const { supabase, orgId, userId } = await requireAdmin();
  const memberId = text(fd, "userId");
  const isAdmin = fd.get("isAdmin") === "on";
  if (memberId === userId && !isAdmin) throw new Error("Du kannst dir die Admin-Rechte nicht selbst nehmen.");
  const { error } = await supabase
    .from("org_members")
    .update({ role: text(fd, "role") || "Mitarbeiter", is_admin: isAdmin })
    .eq("org_id", orgId)
    .eq("user_id", memberId);
  if (error) throw new Error(error.message);
  revalidatePath("/team");
}
