import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

/**
 * Supabase client acting as the caller, from `Authorization: Bearer <access token>` (RLS applies).
 * Returns null when the token is missing or invalid → respond 401.
 */
export async function userFromRequest(request: Request): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}
