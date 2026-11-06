"use client";

import { useActionState } from "react";
import {
  saveUserPermissions,
  updateUserRole,
  updateUserStatus,
  type ManageState,
} from "@/app/(app)/users/manage-actions";

export type ManagedUser = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_sign_in_at: string | null;
};

export type MatrixRow = {
  permission_key: string;
  module: string;
  description: string;
  role_default: boolean;
  override_mode: string;
  effective: boolean;
};

const initialState: ManageState = { error: null, success: null };

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-slate-950";

const cardClass =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

function Message({ state }: { state: ManageState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      >
        {state.success}
      </p>
    );
  }
  return null;
}

export default function ManageUserForms({
  user,
  matrix,
}: {
  user: ManagedUser;
  matrix: MatrixRow[];
}) {
  const [statusState, statusAction, statusPending] = useActionState(
    updateUserStatus,
    initialState
  );
  const [roleState, roleAction, rolePending] = useActionState(
    updateUserRole,
    initialState
  );
  const [permState, permAction, permPending] = useActionState(
    saveUserPermissions,
    initialState
  );

  const modules = Array.from(new Set(matrix.map((row) => row.module)));

  return (
    <div className="space-y-6">
      {/* Account status */}
      <section className={cardClass}>
        <h2 className="font-semibold">Account ki halat</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Band account se employee login nahi kar sakta. Uska record aur purani
          bikri mehfooz rehti hai.
        </p>
        <form
          action={statusAction}
          className="mt-4"
          onSubmit={(event) => {
            if (
              user.is_active &&
              !window.confirm(
                "Is account ko band karna chahte hain? Ye employee login nahi kar sakega."
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="user_id" value={user.id} />
          <input
            type="hidden"
            name="active"
            value={user.is_active ? "false" : "true"}
          />
          <button
            type="submit"
            disabled={statusPending}
            className={
              "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 " +
              (user.is_active
                ? "bg-red-600 hover:bg-red-700"
                : "bg-emerald-600 hover:bg-emerald-700")
            }
          >
            {user.is_active ? "Account band karein" : "Account chalu karein"}
          </button>
        </form>
        <Message state={statusState} />
      </section>

      {/* Role */}
      <section className={cardClass}>
        <h2 className="font-semibold">Role</h2>
        <form action={roleAction} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="user_id" value={user.id} />
          <select
            name="role"
            defaultValue={user.role}
            className={inputClass}
            aria-label="Role"
          >
            <option value="sales">Sales Employee</option>
            <option value="manager">Manager</option>
          </select>
          <button
            type="submit"
            disabled={rolePending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Role badlein
          </button>
        </form>
        <Message state={roleState} />
      </section>

      {/* Permissions */}
      <section className={cardClass}>
        <h2 className="font-semibold">Ijazatein</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          &quot;Default&quot; ka matlab role ke mutabiq. Kisi ek ijazat ko
          alag se dene ya wapas lene ke liye drop-down badlein, phir neeche
          Save dabayein.
        </p>

        <form action={permAction} className="mt-4 space-y-6">
          <input type="hidden" name="user_id" value={user.id} />

          {modules.map((module) => (
            <div key={module}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {module}
              </h3>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {matrix
                  .filter((row) => row.module === module)
                  .map((row) => (
                    <div
                      key={`${row.permission_key}-${row.override_mode}`}
                      className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{row.description}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Role ka default:{" "}
                          {row.role_default ? "Haan" : "Nahi"} · Abhi:{" "}
                          <span
                            className={
                              row.effective
                                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                : "font-semibold text-red-600 dark:text-red-400"
                            }
                          >
                            {row.effective ? "Ijazat hai" : "Ijazat nahi"}
                          </span>
                        </p>
                      </div>
                      <select
                        name={`perm:${row.permission_key}`}
                        defaultValue={row.override_mode}
                        className={inputClass}
                        aria-label={row.description}
                      >
                        <option value="default">Default (role ke mutabiq)</option>
                        <option value="allow">Zabardasti ijazat do</option>
                        <option value="deny">Zabardasti mana karo</option>
                      </select>
                    </div>
                  ))}
              </div>
            </div>
          ))}

          <div>
            <button
              type="submit"
              disabled={permPending}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {permPending ? "Save ho raha hai..." : "Ijazatein save karein"}
            </button>
            <Message state={permState} />
          </div>
        </form>
      </section>
    </div>
  );
}