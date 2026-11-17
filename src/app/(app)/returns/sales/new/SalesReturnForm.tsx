"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Notice, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { formatMoney, toCents } from "@/lib/money";
import { formatDateWith, formatInvoiceNo, type DateFormat } from "@/lib/format";
import { createSalesReturn, previewSalesReturn } from "@/app/(app)/returns/actions";

export type ReturnableSale = {
  sale: {
    id: string;
    invoice_no: number;
    created_at: string;
    status: string;
    customer_name: string | null;
    total: number | string;
    paid_amount: number | string;
    returned_total: number | string;
    refunded_total: number | string;
    due: number | string;
  };
  items: {
    id: string;
    item_type: string;
    description: string;
    imei: string | null;
    quantity: number;
    returned_qty: number;
    line_total: number | string;
  }[];
  accounts: { id: string; name: string; kind: string; is_default: boolean }[];
};

type Line = { selected: boolean; quantity: string; restock: boolean };
type Preview = { total: unknown; credit: unknown; refund: unknown };

const REASONS = ["Faulty item", "Wrong item", "Customer changed mind", "Damaged", "Other"];

export default function SalesReturnForm({
  data,
  today,
  currency,
  dateFormat,
}: {
  data: ReturnableSale;
  today: string;
  currency: string;
  dateFormat: DateFormat;
}) {
  const router = useRouter();
  const returnable = data.items.filter((i) => i.quantity - i.returned_qty > 0);
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(returnable.map((i) => [i.id, { selected: false, quantity: "1", restock: true }]))
  );
  const defaultAccount =
    data.accounts.find((a) => a.kind === "cash" && a.is_default)?.id ?? data.accounts[0]?.id ?? "";
  const [accountId, setAccountId] = useState(defaultAccount);
  const [reason, setReason] = useState(REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today);
  // Preview and its error belong to one selection (itemsKey) only
  const [previewState, setPreviewState] = useState<{ key: string; preview: Preview | null; error: string | null }>({
    key: "",
    preview: null,
    error: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // What is sent to the server; null while a quantity is not valid
  const items = useMemo(() => {
    const chosen = [];
    for (const item of returnable) {
      const line = lines[item.id];
      if (!line?.selected) continue;
      const left = item.quantity - item.returned_qty;
      const qty = item.item_type === "phone" ? 1 : Number(line.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > left) return null;
      chosen.push({ sale_item_id: item.id, quantity: qty, restock: line.restock });
    }
    return chosen;
  }, [lines, returnable]);

  const itemsKey = JSON.stringify(items);

  // Exact values come from the database
  useEffect(() => {
    if (!items || items.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewSalesReturn({ sale_id: data.sale.id, items });
      if (cancelled) return;
      setPreviewState({
        key: itemsKey,
        preview: result.ok ? (result.data as Preview) : null,
        error: result.ok ? null : result.error,
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // itemsKey covers the content of items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, data.sale.id]);

  const current = items && items.length > 0 && previewState.key === itemsKey;
  const shownPreview = current ? previewState.preview : null;
  const previewError = current ? previewState.error : null;
  const refundCents = shownPreview ? toCents(shownPreview.refund) : null;
  const needsAccount = refundCents !== null && refundCents > BigInt(0);

  function update(id: string, patch: Partial<Line>) {
    setLines((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!items || items.length === 0) {
      setError(items === null ? "Check the quantities." : "Choose at least one item to return.");
      return;
    }
    const finalReason = reason === "Other" ? otherReason.trim() : reason;
    if (!finalReason) {
      setError("Write the reason for the return.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await createSalesReturn({
          sale_id: data.sale.id,
          items,
          reason: finalReason,
          notes: notes.trim(),
          return_date: date,
          refund_account_id: needsAccount ? accountId : "",
        });
        if (result.ok && result.id) {
          router.push(`/returns/sales/${result.id}`);
        } else {
          setError(result.error ?? "The return could not be saved.");
        }
      } catch {
        setError("The return could not be saved. Please check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold text-ink">{formatInvoiceNo(data.sale.invoice_no)}</p>
            <p className="text-sm text-ink-muted">
              {formatDateWith(data.sale.created_at, dateFormat)} · {data.sale.customer_name || "Walk-in customer"}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Total</dt>
            <dd className="text-right font-semibold text-ink">{formatMoney(data.sale.total, currency)}</dd>
            <dt className="text-ink-muted">Still owed</dt>
            <dd className="text-right font-semibold text-ink">{formatMoney(data.sale.due, currency)}</dd>
            {Number(data.sale.returned_total) > 0 && (
              <>
                <dt className="text-ink-muted">Returned before</dt>
                <dd className="text-right text-ink">{formatMoney(data.sale.returned_total, currency)}</dd>
              </>
            )}
          </dl>
        </div>
      </section>

      <section className={cardClass} aria-labelledby="items-title">
        <h2 id="items-title" className="mb-3 text-base font-bold text-ink">
          Items to return
        </h2>
        {returnable.length === 0 ? (
          <p className="text-sm text-ink-muted">Everything on this invoice has already been returned.</p>
        ) : (
          <ul className="divide-y divide-line">
            {returnable.map((item) => {
              const line = lines[item.id];
              const left = item.quantity - item.returned_qty;
              return (
                <li key={item.id} className="space-y-2 py-3">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={line.selected}
                      onChange={(e) => update(item.id, { selected: e.target.checked })}
                      className="mt-1 h-5 w-5 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{item.description}</span>
                      <span className="block text-xs text-ink-muted">
                        {item.imei ? `IMEI ${item.imei} · ` : ""}
                        Sold {item.quantity}
                        {item.returned_qty > 0 ? ` · returned ${item.returned_qty}` : ""} · line{" "}
                        {formatMoney(item.line_total, currency)}
                      </span>
                    </span>
                  </label>
                  {line.selected && (
                    <div className="ml-8 flex flex-wrap items-center gap-3">
                      {item.item_type !== "phone" && (
                        <label className="flex items-center gap-2 text-sm text-ink">
                          Quantity
                          <input
                            type="number"
                            min={1}
                            max={left}
                            step={1}
                            value={line.quantity}
                            onChange={(e) => update(item.id, { quantity: e.target.value })}
                            className={inputClass + " w-24"}
                            aria-label={`Quantity of ${item.description}`}
                          />
                          <span className="text-xs text-ink-muted">of {left}</span>
                        </label>
                      )}
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={line.restock}
                          onChange={(e) => update(item.id, { restock: e.target.checked })}
                          className="h-5 w-5 accent-[var(--accent)]"
                        />
                        Put back in stock
                      </label>
                      {!line.restock && (
                        <span className="text-xs text-ink-muted">Will be written off (for example damaged).</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={cardClass + " grid gap-3 sm:grid-cols-2"}>
        <div>
          <label htmlFor="reason" className={labelClass}>
            Reason
          </label>
          <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {reason === "Other" && (
            <input
              type="text"
              maxLength={300}
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              placeholder="Write the reason"
              aria-label="Reason"
              className={inputClass + " mt-2"}
            />
          )}
        </div>
        <div>
          <label htmlFor="return-date" className={labelClass}>
            Date
          </label>
          <input
            id="return-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="return-notes" className={labelClass}>
            Note (optional)
          </label>
          <input
            id="return-notes"
            type="text"
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </div>
      </section>

      <section className={cardClass + " space-y-3"} aria-live="polite">
        {items === null && <Notice kind="error">Check the quantities.</Notice>}
        {previewError && <Notice kind="error">{previewError}</Notice>}
        {needsAccount && data.accounts.length === 0 && (
          <Notice kind="error">There is no active account to pay the refund from.</Notice>
        )}
        {shownPreview ? (
          <dl className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-surface-muted px-4 py-3">
              <dt className="text-xs text-ink-muted">Value returned</dt>
              <dd className="text-lg font-bold text-ink">{formatMoney(shownPreview.total, currency)}</dd>
            </div>
            <div className="rounded-2xl bg-aqua px-4 py-3">
              <dt className="text-xs text-ink-muted">Less owed</dt>
              <dd className="text-lg font-bold text-ink">{formatMoney(shownPreview.credit, currency)}</dd>
            </div>
            <div className="rounded-2xl bg-peach px-4 py-3">
              <dt className="text-xs text-ink-muted">Refund now</dt>
              <dd className="text-lg font-bold text-ink">{formatMoney(shownPreview.refund, currency)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">Choose items to see the refund.</p>
        )}

        {needsAccount && (
          <div>
            <label htmlFor="refund-account" className={labelClass}>
              Refund paid from
            </label>
            <select
              id="refund-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={inputClass}
            >
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <Notice kind="error">{error}</Notice>}
        <button type="submit" disabled={pending || !items || items.length === 0} className={primaryButtonClass + " w-full sm:w-auto"}>
          {pending ? "Saving..." : "Save return"}
        </button>
      </section>
    </form>
  );
}
