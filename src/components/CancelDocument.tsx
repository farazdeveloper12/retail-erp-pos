"use client";

import { useState, useTransition } from "react";
import { Ban } from "lucide-react";
import { Notice, inputClass, labelClass } from "@/components/ui";

export type CancelResult = { ok: boolean; error: string | null };

// "Cancel ..." button that opens an inline confirmation panel (no browser
// dialog) with an optional reason. The server action does the work.
export default function CancelDocument({
  id,
  buttonLabel,
  explanation,
  keepLabel,
  action,
}: {
  id: string;
  buttonLabel: string;
  explanation: string;
  keepLabel: string;
  action: (input: { id: string; reason: string }) => Promise<CancelResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action({ id, reason: reason.trim() });
        if (result.ok) setOpen(false);
        else setError(result.error ?? "The cancellation could not be saved.");
      } catch {
        setError("The cancellation could not be saved. Please check your connection and try again.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-sm font-semibold text-danger transition hover:bg-danger-soft"
      >
        <Ban className="h-4 w-4" />
        {buttonLabel}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={buttonLabel}
      className="w-full basis-full space-y-3 rounded-2xl border-2 border-dashed border-danger/40 bg-danger-soft/40 p-4"
    >
      <p className="text-sm font-semibold text-ink">{explanation}</p>
      <div>
        <label htmlFor={`cancel-reason-${id}`} className={labelClass}>
          Reason (optional)
        </label>
        <input
          id={`cancel-reason-${id}`}
          type="text"
          maxLength={200}
          autoComplete="off"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-coral px-5 text-sm font-semibold text-pill-ink disabled:opacity-60"
        >
          {pending ? "Cancelling..." : "Confirm cancellation"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong bg-surface px-5 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {keepLabel}
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
