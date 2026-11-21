"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X } from "lucide-react";
import { Notice, dangerButtonClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { deleteEntry, type EntryResult, type EntryType } from "@/lib/entry-actions";

// A panel with a required reason, used for every edit and delete
export function ReasonPanel({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<EntryResult>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;

  async function confirm() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onConfirm(reason.trim());
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error ?? "The change could not be saved.");
    } catch {
      setError("The change could not be saved. Please check your connection.");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-4 rounded-card border-2 border-dashed border-line-strong bg-surface p-4 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
      <div>
        <label className={labelClass}>
          Reason (required)
          <textarea
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this changed? It is saved in the history."
            className={inputClass + " mt-1.5"}
          />
        </label>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!valid || saving}
          className={danger ? dangerButtonClass : primaryButtonClass}
        >
          {saving ? "Saving..." : confirmLabel}
        </button>
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Delete button with the reason panel. After deleting it goes to `afterHref`
// (for detail pages) or refreshes the current page (for lists).
export function DeleteEntryButton({
  type,
  id,
  label,
  explanation,
  afterHref,
  compact,
}: {
  type: EntryType;
  id: string;
  label: string;
  explanation: string;
  afterHref?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={compact ? `Delete ${label}` : undefined}
        className={
          compact
            ? "inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-danger-soft hover:text-danger print:hidden"
            : secondaryButtonClass + " print:hidden"
        }
      >
        <Trash2 className="h-4 w-4" />
        {!compact && "Delete"}
      </button>
    );
  }

  return (
    <div className="basis-full">
      <ReasonPanel
        title={`Delete ${label}`}
        confirmLabel="Delete"
        danger
        onClose={() => setOpen(false)}
        onConfirm={async (reason) => {
          const result = await deleteEntry(type, id, reason);
          if (result.ok) {
            if (afterHref) router.push(afterHref);
            else router.refresh();
          }
          return result;
        }}
      >
        <p className="text-sm text-ink-muted">{explanation}</p>
      </ReasonPanel>
    </div>
  );
}

export function EditButton({ onClick, compact, label }: { onClick: () => void; compact?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={compact ? `Edit ${label}` : undefined}
      className={
        compact
          ? "inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-surface-muted print:hidden"
          : secondaryButtonClass + " print:hidden"
      }
    >
      <Pencil className="h-4 w-4" />
      {!compact && "Edit"}
    </button>
  );
}
