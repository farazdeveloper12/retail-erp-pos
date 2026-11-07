import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(app)/actions";
import AppShell from "@/components/AppShell";
import { navItems } from "@/lib/navigation";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { getMyBusiness } from "@/lib/business";

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

  // No profile or an inactive account: do not allow access to the app
  if (!profile || !profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-soft">
          <h1 className="text-lg font-bold text-ink">Account unavailable</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Your profile is missing or has been deactivated. Please contact the
            owner.
          </p>
          <form action={signOut} className="mt-5">
            <button
              type="submit"
              className="min-h-11 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-strong"
            >
              Log out
            </button>
          </form>
        </div>
      </main>
    );
  }

  // Which items should appear in the sidebar, and the business name
  const [permissions, business] = await Promise.all([
    getMyPermissions(),
    getMyBusiness(),
  ]);
  const allowedSlugs = navItems
    .filter((item) => canViewPage(permissions, item.slug))
    .map((item) => item.slug);

  return (
    <AppShell
      userName={profile.full_name}
      userRole={roleLabels[profile.role] ?? profile.role}
      allowedSlugs={allowedSlugs}
      businessName={business?.name ?? null}
    >
      {children}
    </AppShell>
  );
}