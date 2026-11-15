import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { BackLink, Notice, PageHeader, RolePill } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { NameForm, PasswordForm } from "@/app/(app)/settings/account/AccountForms";

export const metadata: Metadata = {
  title: "My account",
};

// Every signed-in user may open this page; it only changes their own account.
export default async function AccountPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const email = typeof claims?.claims?.email === "string" ? claims.claims.email : null;

  const { data: profile } = userId
    ? await supabase.from("profiles").select("full_name, role").eq("id", userId).maybeSingle()
    : { data: null };
  const permissions = await getMyPermissions();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        {canViewPage(permissions, "settings") && <BackLink href="/settings">Back to settings</BackLink>}
        <PageHeader icon={UserCog} title="My account" description={email ?? undefined} />
      </div>

      {!profile ? (
        <Notice kind="error">Your profile could not be loaded.</Notice>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            Role <RolePill role={(profile as { role: string }).role} />
          </p>
          <NameForm fullName={(profile as { full_name: string }).full_name} />
          <PasswordForm />
        </>
      )}
    </div>
  );
}
