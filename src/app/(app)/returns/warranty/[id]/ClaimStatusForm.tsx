"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Notice, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { claimStatusLabel, type ClaimStatus } from "@/lib/returns";
import { updateWarrantyClaim } from "@/app/(app)/returns/actions";

export default function ClaimStatusForm({
  claimId,
  next,
  suppliers,
  today,
}: {
  claimId: string;
  next: ClaimStatus[];
  suppliers: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ClaimStatus>(next[0]);
  const [supplierId, setSupplierId] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (status === "sent_out" && !supplierId && !sentTo.trim()) {
      return setError("Write where the item was sent.");
    }
    startTransition(async () => {
      try {
        const result = await updateWarrantyClaim({
          claim_id: claimId,
          status,
          supplier_id: status === "sent_out" ? supplierId : "",
          sent_to: status === "sent_out" ? sentTo.trim() : "",
          note: note.trim(),
          event_date: date,
        });
        if (result.ok) {
          setNote("");
          setSentTo("");
          router.refresh();
        } else {
          setError(result.error ?? "The claim could not be updated.");
        }
      } catch {
        setError("The claim could not be updated. Please check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className={cardClass + " space-y-4 print:hidden"}>
      <h2 className="text-base font-bold text-ink">Update status</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="New status">
        {next.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={status === s}
            onClick={() => setStatus(s)}
            className={
              "min-h-11 rounded-full border px-4 text-sm font-semibold " +
              (status === s ? "border-transparent bg-pill text-pill-ink" : "border-line text-ink-muted hover:text-ink")
            }
          >
            {claimStatusLabel(s)}
          </button>
        ))}
      </div>

      {status === "sent_out" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {suppliers.length > 0 && (
            <div>
              <label htmlFor="cs-supplier" className={labelClass}>
                Supplier
              </label>
              <select
                id="cs-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className={inputClass}
              >
                <option value="">Not a supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="cs-sent-to" className={labelClass}>
              Sent to {supplierId ? "(optional)" : ""}
            </label>
            <input
              id="cs-sent-to"
              type="text"
              maxLength={120}
              value={sentTo}
              onChange={(e) => setSentTo(e.target.value)}
              placeholder="For example a repair shop"
              className={inputClass}
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="cs-note" className={labelClass}>
            Note (optional)
          </label>
          <input
            id="cs-note"
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="cs-date" className={labelClass}>
            Date
          </label>
          <input
            id="cs-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      <button type="submit" disabled={pending} className={primaryButtonClass + " w-full sm:w-auto"}>
        {pending ? "Saving..." : `Mark as ${claimStatusLabel(status).toLowerCase()}`}
      </button>
    </form>
  );
}
