import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import ManageUserForms, {
  type ManagedUser,
  type MatrixRow,
} from "@/app/(app)/users/manage/ManageUserForms";

export const metadata: Metadata = {
  title: "User manage karein",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  sales: "Sales Employee",
};

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
    >
      {message}
    </div>
  );
}

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

  const backLink = (
    <Link
      href="/users"
      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
    >
      <ArrowLeft className="h-4 w-4" />
      Users ki list par wapas
    </Link>
  );

  if (usersError) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {backLink}
        <ErrorBox message={`User nahi mil saka: ${usersError.message}`} />
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
      <div>
        <h1 className="text-2xl font-bold">{user.full_name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {user.email} · {roleLabels[user.role] ?? user.role} ·{" "}
          {user.is_active ? "Active" : "Band"}
        </p>
      </div>
    </div>
  );

  if (user.role === "owner") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {header}
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Owner ko hamesha sab ijazatein milti hain, aur Owner ka account yahan
          se badla nahi ja sakta. Ye aap ke karobar ki hifazat ke liye hai.
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
        <ErrorBox message={`Ijazatein nahi mil sakin: ${matrixError.message}`} />
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