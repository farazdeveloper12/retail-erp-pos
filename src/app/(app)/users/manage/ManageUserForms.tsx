"use client";

import { useActionState } from "react";
import {
  saveUserPermissions,
  updateUserRole,
  updateUserStatus,
  type ManageState,
} from "@/app/(app)/users/manage-actions";
import {
  Notice,
  cardClass,
  dangerButtonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/components/ui";

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

function Message({ state }: { state: ManageState }) {
  if (state.error) {
    return (
      <div className="mt-4">
        <Notice kind="error">{state.error}</Notice>
      </div>
    );
  }
  if (state.success) {
    return (
      <div className="mt-4">
        <Notice kind="success">{state.success}</Notice>
      </div>
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
        <h2 className="text-base font-bold text-ink">Account status</h2>
        <p className="mt-1 text-sm text-ink-muted">
          A deactivated employee cannot sign in. Their records and past sales
          are kept safe.
        </p>
        <form
          action={statusAction}
          className="mt-4"
          onSubmit={(event) => {
            if (
              user.is_active &&
              !window.confirm(
                "Deactivate this account? This employee will no longer be able to sign in."
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
            className={user.is_active ? dangerButtonClass : primaryButtonClass}
          >
            {user.is_active ? "Deactivate account" : "Activate account"}
          </button>
        </form>
        <Message state={statusState} />
      </section>

      {/* Role */}
      <section className={cardClass}>
        <h2 className="text-base font-bold text-ink">Role</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The role sets the default permissions for this person.
        </p>
        <form
          action={roleAction}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="user_id" value={user.id} />
          <div className="sm:w-64">
            <label htmlFor="manage-role" className={labelClass}>
              Role
            </label>
            <select
              id="manage-role"
              name="role"
              defaultValue={user.role}
              className={inputClass}
            >
              <option value="sales">Sales Employee</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={rolePending}
            className={primaryButtonClass}
          >
            {rolePending ? "Saving..." : "Update role"}
          </button>
        </form>
        <Message state={roleState} />
      </section>

      {/* Permissions */}
      <section className={cardClass}>
        <h2 className="text-base font-bold text-ink">Permissions</h2>
        <p className="mt-1 text-sm text-ink-muted">
          &quot;Default&quot; follows the role. To grant or remove a single
          permission for this person, change its option and then press Save.
        </p>

        <form action={permAction} className="mt-5 space-y-6">
          <input type="hidden" name="user_id" value={user.id} />

          {modules.map((module) => (
            <div key={module}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
                {module}
              </h3>
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {matrix
                  .filter((row) => row.module === module)
                  .map((row) => (
                    <div
                      key={`${row.permission_key}-${row.override_mode}`}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          {row.description}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          Role default: {row.role_default ? "Yes" : "No"}
                          <span
                            className={
                              "rounded-full px-2 py-0.5 font-semibold text-ink " +
                              (row.effective ? "bg-mint" : "bg-peach")
                            }
                          >
                            {row.effective ? "Allowed" : "Not allowed"}
                          </span>
                        </p>
                      </div>
                      <select
                        name={`perm:${row.permission_key}`}
                        defaultValue={row.override_mode}
                        className={inputClass + " sm:w-60"}
                        aria-label={row.description}
                      >
                        <option value="default">Default (follow role)</option>
                        <option value="allow">Always allow</option>
                        <option value="deny">Always deny</option>
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
              className={primaryButtonClass + " w-full sm:w-auto"}
            >
              {permPending ? "Saving..." : "Save permissions"}
            </button>
            <Message state={permState} />
          </div>
        </form>
      </section>
    </div>
  );
}
