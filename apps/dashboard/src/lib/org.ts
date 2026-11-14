import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type OrgContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  orgId: string;
  orgName: string;
  role: string;
  isAdmin: boolean;
};

/**
 * Signed-in user + their org. Redirects to /login without a session or membership.
 * RLS does the real access control; this only picks the org and the admin flag for the UI.
 */
export async function getOrgContext(): Promise<OrgContext> {
  await connection(); // always request-time (Supabase auth reads the clock → would break prerendering)
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: member } = await supabase
    .from("org_members")
    .select("org_id, role, is_admin, orgs(name)")
    .eq("user_id", claims.sub)
    .limit(1)
    .maybeSingle();
  if (!member) redirect("/login?fehler=keine-organisation");

  const org = member.orgs as unknown as { name: string } | null;
  return {
    supabase,
    userId: claims.sub,
    email: String(claims.email ?? ""),
    orgId: member.org_id,
    orgName: org?.name ?? "",
    role: member.role,
    isAdmin: member.is_admin,
  };
}

/** For Server Actions that change org data: signed in AND org admin, otherwise throw. */
export async function requireAdmin(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx.isAdmin) throw new Error("Nur Admins der Organisation dürfen das ändern.");
  return ctx;
}
