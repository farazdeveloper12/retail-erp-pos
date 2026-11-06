"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import {
  createEmployee,
  type CreateUserState,
} from "@/app/(app)/users/actions";

const initialState: CreateUserState = {
  error: null,
  success: null,
  values: { full_name: "", email: "", role: "sales" },
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-slate-950";

export default function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createEmployee,
    initialState
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-blue-600" />
        <h2 className="font-semibold">Naya employee banayein</h2>
      </div>

      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className="mb-1 block text-sm font-medium">
            Naam
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            defaultValue={state.values.full_name}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={state.values.email}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="role" className="mb-1 block text-sm font-medium">
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
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password (kam az kam 12 characters)
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="confirm_password"
            className="mb-1 block text-sm font-medium"
          >
            Password dobara likhein
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
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
          >
            {state.error}
          </p>
        )}

        {state.success && (
          <p
            role="status"
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:col-span-2 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            {state.success}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? "Account ban raha hai..." : "Account banayein"}
          </button>
        </div>
      </form>
    </section>
  );
}