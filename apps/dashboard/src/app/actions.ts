"use server";
import { FeatureListSchema } from "@lotse/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/org";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const liste = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export async function anmelden(fd: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: text(fd, "email"), password: text(fd, "password") });
  if (error) redirect("/login?error=credentials");
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
  redirect("/apps?ok=created");
}

export async function domainsSpeichern(fd: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("apps").update({ domains: liste(text(fd, "domains")) }).eq("id", text(fd, "appId"));
  if (error) throw new Error(error.message);
  revalidatePath("/apps");
  redirect("/apps?ok=saved");
}

/** Replaces the whole feature list of an app with pasted JSON (format of demo-crm/lotse-features.json). */
export async function funktionenImportieren(fd: FormData) {
  const { supabase } = await requireAdmin();
  const appId = text(fd, "appId");
  let parsed;
  try {
    parsed = FeatureListSchema.safeParse(JSON.parse(text(fd, "json")));
  } catch {
    redirect(`/apps?error=json&app=${appId}`);
  }
  if (!parsed.success) redirect(`/apps?error=format&app=${appId}`);

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
  redirect("/trainings?ok=1");
}

export async function mitgliedSpeichern(fd: FormData) {
  const { supabase, orgId, userId } = await requireAdmin();
  const memberId = text(fd, "userId");
  const isAdmin = fd.get("isAdmin") === "on";
  if (memberId === userId && !isAdmin) throw new Error("You can't remove your own admin rights.");
  const { error } = await supabase
    .from("org_members")
    .update({ role: text(fd, "role") || "Employee", is_admin: isAdmin })
    .eq("org_id", orgId)
    .eq("user_id", memberId);
  if (error) throw new Error(error.message);
  revalidatePath("/team");
  redirect("/team?ok=saved");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Onboarding: creates an org with the caller as first admin.
 * Not signed in → sign up (email + password) first. One org per user for the demo.
 * orgs/org_members have no self-insert policy, so the insert uses the secret key — only after getUser() verified the caller.
 */
export async function organisationAnlegen(fd: FormData) {
  const orgName = text(fd, "orgName");
  const role = text(fd, "role") || "Office";
  if (!orgName) redirect("/signup?error=name");

  const supabase = await createClient();
  let { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const email = text(fd, "email").toLowerCase();
    const password = String(fd.get("password") ?? "");
    if (!EMAIL.test(email)) redirect("/signup?error=email");
    if (password.length < 8) redirect("/signup?error=password");
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) redirect("/signup?error=account");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) redirect("/signup?error=account");
    ({ data: { user } } = await supabase.auth.getUser());
    if (!user) redirect("/signup?error=account");
  }

  const admin = createAdminClient();
  const { count } = await admin.from("org_members").select("org_id", { count: "exact", head: true }).eq("user_id", user.id);
  if (count) redirect("/");

  const { data: org, error: orgError } = await admin.from("orgs").insert({ name: orgName }).select("id").single();
  if (orgError || !org) throw new Error(orgError?.message ?? "Could not create the organization.");
  const { error: memberError } = await admin
    .from("org_members")
    .insert({ org_id: org.id, user_id: user.id, role, is_admin: true, email: user.email ?? null });
  if (memberError) {
    await admin.from("orgs").delete().eq("id", org.id);
    throw new Error(memberError.message);
  }
  redirect("/signup?ok=1");
}

/** Admin invites a person: creates the auth user with a start password (or reuses an existing one) and adds them to the org. */
export async function mitgliedEinladen(fd: FormData) {
  const { supabase, orgId } = await requireAdmin();
  const email = text(fd, "email").toLowerCase();
  const role = text(fd, "role");
  const password = String(fd.get("password") ?? "");
  const isAdmin = fd.get("isAdmin") === "on";
  if (!EMAIL.test(email)) redirect("/team?error=email");
  if (!role) redirect("/team?error=role");
  if (password.length < 8) redirect("/team?error=password"); // also for existing accounts: keeps the rule simple

  const admin = createAdminClient();
  let neu = false;
  let userId: string | undefined;
  const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.user) {
    userId = created.user.id;
    neu = true;
  } else {
    // ponytail: scans the first 1000 users; fine for the demo, use a lookup by email if the project grows.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (!userId) redirect("/team?error=account");
  }

  // RLS "admins manage members" checks the org.
  const { error } = await supabase.from("org_members").insert({ org_id: orgId, user_id: userId, role, is_admin: isAdmin, email });
  if (error) redirect(error.code === "23505" ? "/team?error=already-member" : "/team?error=save");
  revalidatePath("/team");
  redirect(neu ? "/team?ok=invited" : "/team?ok=added");
}

/** Removes a person from the org (only the membership — the login account stays). */
export async function mitgliedEntfernen(fd: FormData) {
  const { supabase, orgId, userId } = await requireAdmin();
  const memberId = text(fd, "userId");
  if (!memberId || memberId === userId) redirect("/team?error=self");
  const { error } = await supabase.from("org_members").delete().eq("org_id", orgId).eq("user_id", memberId);
  if (error) redirect("/team?error=save");
  revalidatePath("/team");
  redirect("/team?ok=removed");
}
