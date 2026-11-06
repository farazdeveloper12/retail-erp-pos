import "server-only";
import { createClient } from "@supabase/supabase-js";

// Ye connection secret key istemal karta hai.
// Isay sirf server ke andar, ijazat check karne ke baad istemal karna hai.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SECRET_KEY nahi mili. .env.local file check karein, " +
        "phir dev server band kar ke dobara chalayein."
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}