import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, UserCog, Users } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  EmptyState,
  Notice,
  PageHeader,
  RolePill,
  StatusPill,
  cardClass,
} from "@/components/ui";
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

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lavender text-sm font-bold text-purple">
      {initials(name)}
    </span>
  );
}

function ManageLink({ user }: { user: UserRow }) {
  if (user.role === "owner") {
    return <span className="text-xs text-ink-muted">Full access</span>;
  }
  return (
    <Link
      href={`/users/manage?id=${user.id}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
    >
      Manage
      <ChevronRight className="h-4 w-4" />
    </Link>
  );
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
      <PageHeader
        icon={UserCog}
        title="Users & Roles"
        description="Create employee accounts and manage what each person can access."
      />

      <CreateUserForm />

      <section aria-labelledby="team-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="team-heading" className="text-base font-bold text-ink">
            Team members
          </h2>
          {!error && users.length > 0 && (
            <p className="text-xs text-ink-muted">
              {users.length} {users.length === 1 ? "person" : "people"}
            </p>
          )}
        </div>

        {error ? (
          <Notice kind="error">Could not load the user list: {error.message}</Notice>
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No team members yet"
            text="Create the first employee account using the form above."
          />
        ) : (
          <>
            {/* Phone: card list */}
            <ul className="space-y-3 md:hidden">
              {users.map((user) => (
                <li key={user.id} className={cardClass}>
                  <div className="flex items-start gap-3">
                    <Avatar name={user.full_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">
                        {user.full_name}
                      </p>
                      <p className="truncate text-sm text-ink-muted">
                        {user.email}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <RolePill role={user.role} />
                        <StatusPill active={user.is_active} />
                      </div>
                      <p className="mt-2 text-xs text-ink-muted">
                        Last sign-in: {formatDate(user.last_sign_in_at)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <ManageLink user={user} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablet and laptop: table */}
            <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Last sign-in</th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={user.full_name} />
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">
                              {user.full_name}
                            </p>
                            <p className="text-xs text-ink-muted">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <RolePill role={user.role} />
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill active={user.is_active} />
                      </td>
                      <td className="px-5 py-3 text-ink-muted">
                        {formatDate(user.last_sign_in_at)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ManageLink user={user} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
