"use client";

import { useState, useTransition } from "react";
import { voidExpense } from "@/app/(app)/expenses/actions";

// "Cancel" with an inline Yes / No confirmation (no browser dialog)
export default function CancelExpenseButton({ expenseId }: { expenseId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await voidExpense(expenseId);
        if (!result.ok) {
          setError(result.error ?? "The expense could not be cancelled.");
          setConfirming(false);
        }
        // On success the page reloads and this row leaves the list
      } catch {
        setError("The expense could not be cancelled. Please check your connection and try again.");
        setConfirming(false);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div role="group" aria-label="Confirm cancelling this expense" className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs font-semibold text-ink">Cancel this expense?</span>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-full bg-coral px-4 text-xs font-semibold text-pill-ink disabled:opacity-60"
          >
            {pending ? "Cancelling..." : "Yes"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-xs font-semibold text-ink disabled:opacity-60"
          >
            No
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-xs font-semibold text-ink transition hover:bg-danger-soft hover:text-danger"
        >
          Cancel
        </button>
      )}
      {error && (
        <span role="alert" className="max-w-xs text-right text-xs font-medium text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
