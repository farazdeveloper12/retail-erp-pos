import type { Metadata } from "next";
import { ShieldCheck, Store } from "lucide-react";
import LoginForm from "@/app/login/LoginForm";

export const metadata: Metadata = {
  title: "Log in",
};

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      {/* Soft decorative shapes */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-aqua opacity-70 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-peach opacity-70 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-soft">
            <Store className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Sign in to your retail workspace
            </p>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-6 shadow-soft sm:p-7">
          <LoginForm />
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
          <ShieldCheck className="h-4 w-4 text-accent" />
          Accounts are created by the owner.
        </p>
      </div>
    </main>
  );
}
