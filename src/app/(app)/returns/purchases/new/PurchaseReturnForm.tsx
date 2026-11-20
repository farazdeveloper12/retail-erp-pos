"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Notice, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { formatMoney, toCents } from "@/lib/money";
import { formatDateWith, type DateFormat } from "@/lib/format";
import { formatPurchaseNo } from "@/lib/returns";
import { createPurchaseReturn } from "@/app/(app)/returns/actions";

export type ReturnablePurchase = {
  purchase: {
    id: string;
    purchase_no: number;
    purchase_date: string;
    status: string;
    supplier_name: string | null;
    total: number | string;
    returned_total: number | string;
    due: number | string;
  };
  accessories: {
    id: string;
    description: string;
    quantity: number;
    unit_cost: number | string;
    returned_qty: number;
    in_stock: number | string;
  }[];
  phones: { id: string; imei: string; status: string; description: string; unit_cost: number | string }[];
  accounts: { id: string; name: string; kind: string; is_default: boolean }[];
};

const REASONS = ["Faulty item", "Wrong item", "Damaged", "Not needed", "Other"];
const ZERO = BigInt(0);

export default function PurchaseReturnForm({
  data,
  today,
  currency,
  dateFormat,
}: {
  data: ReturnablePurchase;
  today: string;
  currency: string;
  dateFormat: DateFormat;
}) {
  const router = useRouter();
  const phones = data.phones.filter((p) => p.status === "in_stock");
  const accessories = data.accessories.filter(
    (a) => Math.min(a.quantity - a.returned_qty, Math.floor(Number(a.in_stock))) > 0
  );
  const [phoneIds, setPhoneIds] = useState<Set<string>>(() => new Set());
  const [qty, setQty] = useState<Record<string, string>>({});
  const defaultAccount =
    data.accounts.find((a) => a.kind === "cash" && a.is_default)?.id ?? data.accounts[0]?.id ?? "";
  const [accountId, setAccountId] = useState(defaultAccount);
  const [reason, setReason] = useState(REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Preview only; the database works out the saved amounts
  const { items, totalCents, valid } = useMemo(() => {
    let total = ZERO;
    let ok = true;
    const chosen: { purchase_item_id: string; quantity: number }[] = [];
    for (const p of phones) if (phoneIds.has(p.id)) total += toCents(p.unit_cost) ?? ZERO;
    for (const a of accessories) {
      const raw = qty[a.id]?.trim();
      if (!raw || raw === "0") continue;
      const n = Number(raw);
      const max = Math.min(a.quantity - a.returned_qty, Math.floor(Number(a.in_stock)));
      if (!Number.isInteger(n) || n < 0 || n > max) {
        ok = false;
        continue;
      }
      chosen.push({ purchase_item_id: a.id, quantity: n });
      total += (toCents(a.unit_cost) ?? ZERO) * BigInt(n);
    }
    return { items: chosen, totalCents: total, valid: ok };
  }, [phones, accessories, phoneIds, qty]);

  const dueCents = toCents(data.purchase.due) ?? ZERO;
  const creditCents = totalCents < dueCents ? totalCents : dueCents > ZERO ? dueCents : ZERO;
  const refundCents = totalCents - creditCents;
  const count = phoneIds.size + items.length;

  function togglePhone(id: string, on: boolean) {
    setPhoneIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!valid) return setError("Check the quantities.");
    if (count === 0) return setError("Choose at least one item to return.");
    const finalReason = reason === "Other" ? otherReason.trim() : reason;
    if (!finalReason) return setError("Write the reason for the return.");
    startTransition(async () => {
      try {
        const result = await createPurchaseReturn({
          purchase_id: data.purchase.id,
          phone_unit_ids: [...phoneIds],
          items,
          reason: finalReason,
          notes: notes.trim(),
          return_date: date,
          refund_account_id: refundCents > ZERO ? accountId : "",
        });
        if (result.ok && result.id) router.push(`/returns/purchases/${result.id}`);
        else setError(result.error ?? "The return could not be saved.");
      } catch {
        setError("The return could not be saved. Please check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className={cardClass + " flex flex-wrap items-start justify-between gap-3"}>
        <div>
          <p className="text-lg font-bold text-ink">{formatPurchaseNo(data.purchase.purchase_no)}</p>
          <p className="text-sm text-ink-muted">
            {formatDateWith(data.purchase.purchase_date, dateFormat)} · {data.purchase.supplier_name ?? "Supplier"}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Total</dt>
          <dd className="text-right font-semibold text-ink">{formatMoney(data.purchase.total, currency)}</dd>
          <dt className="text-ink-muted">You still owe</dt>
          <dd className="text-right font-semibold text-ink">{formatMoney(data.purchase.due, currency)}</dd>
        </dl>
      </section>

      <section className={cardClass} aria-labelledby="pr-items">
        <h2 id="pr-items" className="mb-3 text-base font-bold text-ink">
          Items to return
        </h2>
        {phones.length === 0 && accessories.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing from this purchase is in stock to return.</p>
        ) : (
          <ul className="divide-y divide-line">
            {phones.map((p) => (
              <li key={p.id} className="py-2">
                <label className="flex min-h-11 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={phoneIds.has(p.id)}
                    onChange={(e) => togglePhone(p.id, e.target.checked)}
                    className="mt-1 h-5 w-5 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{p.description}</span>
                    <span className="block tabular-nums text-xs text-ink-muted">IMEI {p.imei}</span>
                  </span>
                  <span className="text-sm font-semibold text-ink">{formatMoney(p.unit_cost, currency)}</span>
                </label>
              </li>
            ))}
            {accessories.map((a) => {
              const max = Math.min(a.quantity - a.returned_qty, Math.floor(Number(a.in_stock)));
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{a.description}</span>
                    <span className="block text-xs text-ink-muted">
                      Bought {a.quantity}
                      {a.returned_qty > 0 ? ` · returned ${a.returned_qty}` : ""} · in stock {Number(a.in_stock)} ·{" "}
                      {formatMoney(a.unit_cost, currency)} each
                    </span>
                  </span>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    Return
                    <input
                      type="number"
                      min={0}
                      max={max}
                      step={1}
                      placeholder="0"
                      value={qty[a.id] ?? ""}
                      onChange={(e) => setQty((c) => ({ ...c, [a.id]: e.target.value }))}
                      aria-label={`Quantity of ${a.description} to return`}
                      className={inputClass + " w-24"}
                    />
                    <span className="text-xs text-ink-muted">of {max}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={cardClass + " grid gap-3 sm:grid-cols-2"}>
        <div>
          <label htmlFor="pr-reason" className={labelClass}>
            Reason
          </label>
          <select id="pr-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
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
          <label htmlFor="pr-date" className={labelClass}>
            Date
          </label>
          <input
            id="pr-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pr-notes" className={labelClass}>
            Note (optional)
          </label>
          <input
            id="pr-notes"
            type="text"
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </div>
      </section>

      <section className={cardClass + " space-y-3"} aria-live="polite">
        <dl className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-surface-muted px-4 py-3">
            <dt className="text-xs text-ink-muted">Cost returned</dt>
            <dd className="text-lg font-bold text-ink">{formatMoney(totalCents, currency)}</dd>
          </div>
          <div className="rounded-2xl bg-aqua px-4 py-3">
            <dt className="text-xs text-ink-muted">Less owed</dt>
            <dd className="text-lg font-bold text-ink">{formatMoney(creditCents, currency)}</dd>
          </div>
          <div className="rounded-2xl bg-mint px-4 py-3">
            <dt className="text-xs text-ink-muted">Money back</dt>
            <dd className="text-lg font-bold text-ink">{formatMoney(refundCents, currency)}</dd>
          </div>
        </dl>
        <p className="text-xs text-ink-muted">
          Phones count at their purchase cost and accessories at their unit cost. Extra costs such as transport are
          not returned.
        </p>
        {refundCents > ZERO && (
          <div>
            <label htmlFor="pr-account" className={labelClass}>
              Money received into
            </label>
            <select
              id="pr-account"
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
        {!valid && <Notice kind="error">Check the quantities.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        <button type="submit" disabled={pending || count === 0 || !valid} className={primaryButtonClass + " w-full sm:w-auto"}>
          {pending ? "Saving..." : "Save return"}
        </button>
      </section>
    </form>
  );
}
