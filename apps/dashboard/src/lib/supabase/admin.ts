import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client with the secret key. Bypasses RLS — server-only.
 * Only call after checking the signed-in user (getUser / requireAdmin) in the same request.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
