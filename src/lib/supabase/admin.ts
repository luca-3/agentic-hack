import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client with the secret key. Bypasses RLS — server-only.
 * Use for trusted backend work (agent tools, ingestion), never with user-controlled filters you didn't check.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
