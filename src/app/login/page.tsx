import type { Metadata } from "next";
import { Store } from "lucide-react";
import LoginForm from "@/app/login/LoginForm";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <Store className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wide">
              GWADAR TECH HUB
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Apne account se login karein
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}