import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/env";

// Supabase connection for the browser (client components)
export function createClient() {
  const { url, key } = getSupabaseEnv();
  return createBrowserClient(url, key);
}