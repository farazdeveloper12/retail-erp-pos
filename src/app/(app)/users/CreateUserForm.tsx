"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import {
  createEmployee,
  type CreateUserState,
} from "@/app/(app)/users/actions";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/components/ui";

const initialState: CreateUserState = {
  error: null,
  success: null,
  values: { full_name: "", email: "", role: "sales" },
};

export default function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createEmployee,
    initialState
  );

  return (
    <section className={cardClass}>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mint text-ink">
          <UserPlus className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">Add an employee</h2>
          <p className="text-xs text-ink-muted">
            The employee signs in with this email and password.
          </p>
        </div>
      </div>

      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className={labelClass}>
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            placeholder="e.g. Ali Raza"
            defaultValue={state.values.full_name}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="name@example.com"
            defaultValue={state.values.email}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="role" className={labelClass}>
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue={state.values.role}
            className={inputClass}
          >
            <option value="sales">Sales Employee</option>
            <option value="manager">Manager</option>
          </select>
        </div>

        <div className="hidden sm:block" />

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            aria-describedby="password-hint"
            className={inputClass}
          />
          <p id="password-hint" className="mt-1 text-xs text-ink-muted">
            At least 12 characters.
          </p>
        </div>

        <div>
          <label htmlFor="confirm_password" className={labelClass}>
            Confirm password
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className={inputClass}
          />
        </div>

        {state.error && (
          <div className="sm:col-span-2">
            <Notice kind="error">{state.error}</Notice>
          </div>
        )}

        {state.success && (
          <div className="sm:col-span-2">
            <Notice kind="success">{state.success}</Notice>
          </div>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className={primaryButtonClass + " w-full sm:w-auto"}
          >
            {pending ? "Creating account..." : "Create account"}
          </button>
        </div>
      </form>
    </section>
  );
}
