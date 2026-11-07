"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/app/login/actions";

const initialState: LoginState = { error: null };

const inputClass =
  "w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15";

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-semibold text-ink"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-semibold text-ink"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          required
          className={inputClass}
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-soft transition hover:bg-accent-strong disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
