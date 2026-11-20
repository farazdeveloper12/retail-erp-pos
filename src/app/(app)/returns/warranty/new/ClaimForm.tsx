"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Notice, Pill, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { formatDateWith, formatInvoiceNo, type DateFormat } from "@/lib/format";
import { warrantyStatusLabel } from "@/lib/returns";
import { createWarrantyClaim } from "@/app/(app)/returns/actions";

export type SoldItem = {
  sale_item_id: string;
  invoice_no: number;
  sold_on: string;
  customer_name: string | null;
  customer_phone: string | null;
  description: string;
  imei: string | null;
  warranty_days: number;
  expires_on: string;
  days_left: number;
  warranty_status: string;
  open_claim_id: string | null;
};

export default function ClaimForm({
  sold,
  today,
  dateFormat,
}: {
  sold: SoldItem | null;
  today: string;
  dateFormat: DateFormat;
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [imei, setImei] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [issue, setIssue] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!issue.trim()) return setError("Describe the problem.");
    if (!sold && !description.trim()) return setError("Describe the item.");
    if (!sold && imei.trim() && !/^\d{15}$/.test(imei.replace(/\s/g, ""))) {
      return setError("The IMEI must be 15 digits.");
    }
    startTransition(async () => {
      try {
        const result = await createWarrantyClaim({
          sale_item_id: sold?.sale_item_id ?? "",
          item_description: description.trim(),
          imei: imei.trim(),
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          issue: issue.trim(),
          received_on: date,
        });
        if (result.ok && result.id) router.push(`/returns/warranty/${result.id}`);
        else setError(result.error ?? "The claim could not be saved.");
      } catch {
        setError("The claim could not be saved. Please check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {sold ? (
        <section className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{sold.description}</p>
              {sold.imei && <p className="tabular-nums text-xs text-ink-muted">IMEI {sold.imei}</p>}
              <p className="mt-1 text-sm text-ink-muted">
                {formatInvoiceNo(sold.invoice_no)} · sold {formatDateWith(sold.sold_on, dateFormat)} ·{" "}
                {sold.customer_name || "Walk-in customer"}
              </p>
            </div>
            <Pill tone={sold.warranty_status === "active" ? "mint" : sold.warranty_status === "expired" ? "coral" : "neutral"}>
              {warrantyStatusLabel(sold.warranty_status, sold.days_left)}
            </Pill>
          </div>
          {sold.warranty_status !== "active" && (
            <p className="mt-3 text-sm text-ink-muted">
              This item is not under warranty. You can still record the claim; it is marked as outside warranty.
            </p>
          )}
        </section>
      ) : (
        <section className={cardClass + " grid gap-3 sm:grid-cols-2"}>
          <div className="sm:col-span-2">
            <label htmlFor="c-desc" className={labelClass}>
              Item
            </label>
            <input
              id="c-desc"
              type="text"
              maxLength={200}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="For example Samsung A15 128 GB Black"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="c-imei" className={labelClass}>
              IMEI (optional)
            </label>
            <input
              id="c-imei"
              type="text"
              inputMode="numeric"
              maxLength={20}
              value={imei}
              onChange={(e) => setImei(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="c-name" className={labelClass}>
              Customer name (optional)
            </label>
            <input
              id="c-name"
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="c-phone" className={labelClass}>
              Customer phone (optional)
            </label>
            <input
              id="c-phone"
              type="tel"
              maxLength={30}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
            />
          </div>
        </section>
      )}

      <section className={cardClass + " grid gap-3 sm:grid-cols-[2fr_1fr]"}>
        <div>
          <label htmlFor="c-issue" className={labelClass}>
            Problem
          </label>
          <textarea
            id="c-issue"
            rows={3}
            maxLength={1000}
            required
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="For example: does not charge, screen flickers"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="c-date" className={labelClass}>
            Received on
          </label>
          <input
            id="c-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && (
          <div className="sm:col-span-2">
            <Notice kind="error">{error}</Notice>
          </div>
        )}
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending || Boolean(sold?.open_claim_id)}
            className={primaryButtonClass + " w-full sm:w-auto"}
          >
            {pending ? "Saving..." : "Save claim"}
          </button>
          {sold?.open_claim_id && (
            <p className="mt-2 text-sm text-ink-muted">This item already has an open claim.</p>
          )}
        </div>
      </section>
    </form>
  );
}
