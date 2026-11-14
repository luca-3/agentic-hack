"use server";
import { DeleteMyDataResponseSchema, LOTSE_DEFAULTS } from "@lotse/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/org";

const serverUrl = () => process.env.LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl;

/** "Delete all my Valo data": DELETE /api/lotse/me with the user's own token (D-33). */
export async function meineDatenLoeschen(fd: FormData) {
  if (fd.get("confirm") !== "yes") redirect("/my-data?error=confirm");
  const ctx = await getOrgContext();
  const token = (await ctx.supabase.auth.getSession()).data.session?.access_token;
  let total: number | undefined;
  let limited = false;
  try {
    const res = await fetch(`${serverUrl()}/api/lotse/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    limited = res.status === 429;
    const parsed = res.ok ? DeleteMyDataResponseSchema.safeParse(await res.json()).data : undefined;
    if (parsed) total = Object.values(parsed.deleted).reduce((a, b) => a + b, 0);
  } catch {
    total = undefined;
  }
  revalidatePath("/my-data");
  redirect(total !== undefined ? `/my-data?ok=deleted&n=${total}` : limited ? "/my-data?error=rate-limited" : "/my-data?error=delete");
}
