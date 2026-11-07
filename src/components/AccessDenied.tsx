import { Lock } from "lucide-react";

export default function AccessDenied() {
  return (
    <div className="mx-auto max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-soft">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-peach text-coral">
        <Lock className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-lg font-bold text-ink">Access denied</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Your account does not have permission to view this page. Please contact
        the owner if you need access.
      </p>
    </div>
  );
}
