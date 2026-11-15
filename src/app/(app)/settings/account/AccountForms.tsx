"use client";

import { useActionState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import {
  changeMyPassword,
  updateMyName,
  type AccountState,
} from "@/app/(app)/settings/account/actions";
import { Notice, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";

const initial: AccountState = { error: null, success: null };

export function NameForm({ fullName }: { fullName: string }) {
  const [state, action, pending] = useActionState(updateMyName, initial);
  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center gap-2">
        <UserRound className="h-5 w-5 text-accent" />
        <h2 className="text-base font-bold text-ink">Your name</h2>
      </div>
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="account-name" className={labelClass}>
            Full name
          </label>
          <input
            id="account-name"
            name="full_name"
            type="text"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            defaultValue={fullName}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving..." : "Save name"}
        </button>
      </form>
      <div className="mt-3 space-y-2">
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.success && <Notice kind="success">{state.success}</Notice>}
      </div>
    </section>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changeMyPassword, initial);
  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-accent" />
        <h2 className="text-base font-bold text-ink">Change password</h2>
      </div>
      <form action={action} className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="current-password" className={labelClass}>
            Current password
          </label>
          <input
            id="current-password"
            name="current_password"
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="new-password" className={labelClass}>
            New password
          </label>
          <input
            id="new-password"
            name="new_password"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink-muted">At least 12 characters.</p>
        </div>
        <div>
          <label htmlFor="confirm-password" className={labelClass}>
            Confirm new password
          </label>
          <input
            id="confirm-password"
            name="confirm_password"
            type="password"
            required
            minLength={12}
            maxLength={72}
            autoComplete="new-password"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-3">
          <button type="submit" disabled={pending} className={primaryButtonClass + " w-full sm:w-auto"}>
            {pending ? "Saving..." : "Change password"}
          </button>
        </div>
      </form>
      <div className="mt-3 space-y-2">
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.success && <Notice kind="success">{state.success}</Notice>}
      </div>
    </section>
  );
}
