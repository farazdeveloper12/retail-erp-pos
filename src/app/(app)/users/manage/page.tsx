import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  BackLink,
  Notice,
  RolePill,
  StatusPill,
  cardClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import ManageUserForms, {
  type ManagedUser,
  type MatrixRow,
} from "@/app/(app)/users/manage/ManageUserForms";

export const metadata: Metadata = {
  title: "Manage user",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ManageUserPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id || !UUID_PATTERN.test(id)) {
    notFound();
  }

  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "users")) {
    return <AccessDenied />;
  }

  const supabase = await createClient();

  const { data: usersData, error: usersError } =
    await supabase.rpc("list_users");

  const backLink = <BackLink href="/users">Back to users</BackLink>;

  if (usersError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {backLink}
        <Notice kind="error">Could not load this user: {usersError.message}</Notice>
      </div>
    );
  }

  const user = ((usersData ?? []) as ManagedUser[]).find((u) => u.id === id);
  if (!user) {
    notFound();
  }

  const header = (
    <div className="space-y-3">
      {backLink}
      <div className={cardClass + " flex flex-wrap items-center gap-4"}>
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-lavender text-lg font-bold text-purple">
          {user.full_name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold text-ink">
            {user.full_name}
          </h1>
          <p className="truncate text-sm text-ink-muted">{user.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RolePill role={user.role} />
          <StatusPill active={user.is_active} />
        </div>
      </div>
    </div>
  );

  if (user.role === "owner") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <div className={cardClass + " flex items-start gap-3"}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-lavender text-purple">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <p className="text-sm text-ink-muted">
            The owner always has every permission, and the owner account cannot
            be changed from here. This protects your business.
          </p>
        </div>
      </div>
    );
  }

  const { data: matrixData, error: matrixError } = await supabase.rpc(
    "get_user_permission_matrix",
    { target: id }
  );

  if (matrixError) {
    if (matrixError.code === "42501") {
      return <AccessDenied />;
    }
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <Notice kind="error">
          Could not load permissions: {matrixError.message}
        </Notice>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {header}
      <ManageUserForms user={user} matrix={(matrixData ?? []) as MatrixRow[]} />
    </div>
  );
}
