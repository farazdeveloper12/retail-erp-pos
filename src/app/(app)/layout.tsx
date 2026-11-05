import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(app)/actions";
import AppShell from "@/components/AppShell";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  sales: "Sales Employee",
};

type Profile = {
  full_name: string;
  role: string;
  is_active: boolean;
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  let profile: Profile | null = null;
  if (userId) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, role, is_active")
      .eq("id", userId)
      .maybeSingle();
    profile = data as Profile | null;
  }

  // Profile na ho ya account band ho: app ke andar jaane nahi dena
  if (!profile || !profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-bold">Account istemal nahi ho sakta</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Aap ka profile mojood nahi ya band hai. Owner se rabta karein.
          </p>
          <form action={signOut} className="mt-5">
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Logout
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <AppShell
      userName={profile.full_name}
      userRole={roleLabels[profile.role] ?? profile.role}
    >
      {children}
    </AppShell>
  );
}