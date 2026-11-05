export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase ki settings nahi mili. .env.local file check karein: " +
        "NEXT_PUBLIC_SUPABASE_URL aur NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "dono likhi honi chahiye. Phir dev server band kar ke dobara chalayein."
    );
  }

  return { url, key };
}