import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import CreateUserForm from "@/app/(app)/users/CreateUserForm";

export const metadata: Metadata = {
  title: "Users & Roles",
};

type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  sales: "Sales Employee",
};

function formatDate(value: string | null) {
  if (!value) return "Abhi tak nahi";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

export default async function UsersPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "users")) {
    return <AccessDenied />;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_users");
  const users = (data ?? []) as UserRow[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
          <UserCog className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Users &amp; Roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Employees aur unki permissions.
          </p>
        </div>
      </div>

      <CreateUserForm />

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
        >
          Users ki list nahi mil saki: {error.message}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Naam</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Aakhri login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-4 py-3 font-medium">{user.full_name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    {roleLabels[user.role] ?? user.role}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " +
                        (user.is_active
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300")
                      }
                    >
                      {user.is_active ? "Active" : "Band"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {formatDate(user.last_sign_in_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}