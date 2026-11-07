import "server-only";
import { createClient } from "@supabase/supabase-js";

// This connection uses the secret key.
// Use it only on the server, and only after checking permissions.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is missing. Check the .env.local file, " +
        "then stop and restart the dev server."
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}