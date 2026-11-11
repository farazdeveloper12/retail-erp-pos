"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Headphones,
  Plus,
  Printer,
  ShoppingCart,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { centsToPlain, cleanMoneyInput, formatMoney, isValidMoneyInput, toCents } from "@/lib/money";
import { formatInvoiceNo } from "@/lib/format";
import {
  createSale,
  type SaleItemOption,
  type SaleResult,
} from "@/app/(app)/sales/new/actions";
import SaleItemSearch from "@/app/(app)/sales/new/SaleItemSearch";
import CustomerPanel, { type CustomerValue } from "@/app/(app)/sales/new/CustomerPanel";

// ---------- Types and helpers ----------

type SaleLine = {
  key: string;
  kind: "phone" | "accessory";
  refId: string; // phone_unit_id or product_id
  title: string;
  detail: string;
  imei: string | null;
  inStock: number;
  quantity: string;
  unitPrice: string;
  discount: string;
  warranty: string;
  // Present only for users who may see cost; never sent back to the server
  cost: bigint | null;
};

const ZERO = BigInt(0);
const WHOLE = /^\d+$/;

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `line-${keyCounter}`;
}

function lineFromOption(option: SaleItemOption): SaleLine {
  const price = toCents(option.sale_price);
  const cost = "cost" in option ? toCents(option.cost) : null;
  if (option.kind === "phone") {
    return {
      key: newKey(),
      kind: "phone",
      refId: option.phone_unit_id,
      title: option.model,
      detail: [option.storage, option.color, option.condition].filter(Boolean).join(" · "),
      imei: option.imei,
      inStock: 1,
      quantity: "1",
      unitPrice: price === null ? "" : centsToPlain(price),
      discount: "0",
      warranty: "7",
      cost,
    };
  }
  return {
    key: newKey(),
    kind: "accessory",
    refId: option.product_id,
    title: option.name,
    detail: "",
    imei: null,
    inStock: option.in_stock,
    quantity: "1",
    unitPrice: price === null ? "" : centsToPlain(price),
    discount: "0",
    warranty: "0",
    cost,
  };
}

function money(value: string): bigint | null {
  const text = value.trim() === "" ? "0" : value;
  return isValidMoneyInput(text) ? toCents(text) : null;
}

function plainNumber(value: string): number {
  return Number(cleanMoneyInput(value.trim() === "" ? "0" : value));
}

type LineCalc = {
  qty: number | null;
  gross: bigint | null;
  net: bigint | null;
  problems: string[];
  belowCost: boolean;
};

function calculate(line: SaleLine): LineCalc {
  const problems: string[] = [];
  const qtyText = line.quantity.trim();
  let qty: number | null = null;
  if (line.kind === "phone") qty = 1;
  else if (WHOLE.test(qtyText) && Number(qtyText) >= 1 && Number(qtyText) <= line.inStock) {
    qty = Number(qtyText);
  } else {
    problems.push(`quantity must be from 1 to ${line.inStock}`);
  }

  const unit = line.unitPrice.trim() === "" ? null : money(line.unitPrice);
  if (unit === null) problems.push("enter a valid unit price");
  const discount = money(line.discount);
  if (discount === null) problems.push("enter a valid discount");

  const warranty = line.warranty.trim() === "" ? "0" : line.warranty.trim();
  if (!WHOLE.test(warranty) || Number(warranty) > 3650) {
    problems.push("warranty must be 0 to 3650 days");
  }

  const gross = qty !== null && unit !== null ? unit * BigInt(qty) : null;
  let net: bigint | null = null;
  if (gross !== null && discount !== null) {
    if (discount > gross) problems.push("discount cannot be more than the line amount");
    else net = gross - discount;
  }

  const belowCost =
    line.cost !== null && net !== null && qty !== null && net < line.cost * BigInt(qty);

  return { qty, gross, net, problems, belowCost };
}

const emptyCustomer: CustomerValue = { existing: null, name: "", phone: "" };

// ---------- Main component ----------

export default function SaleEntry({
  currency,
  seesCost,
}: {
  currency: string;
  seesCost: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const addItemRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<string | null>(null);

  const [lines, setLines] = useState<SaleLine[]>([]);
  const [customer, setCustomer] = useState<CustomerValue>(emptyCustomer);
  const [invoiceDiscount, setInvoiceDiscount] = useState("0");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [paid, setPaid] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);

  // Focus a field after lines were added, or the Add item box after a reset
  useEffect(() => {
    if (!pendingFocus.current || !rootRef.current) return;
    const target =
      pendingFocus.current === "add-item"
        ? addItemRef.current
        : rootRef.current.querySelector<HTMLElement>(pendingFocus.current);
    target?.focus();
    pendingFocus.current = null;
  });

  function fieldSelector(index: number, field?: string) {
    return `[data-sale-field][data-line="${index}"]${field ? `[data-field="${field}"]` : ""}`;
  }

  // ---------- Lines ----------

  function addItem(option: SaleItemOption) {
    setNotice(null);
    if (option.kind === "phone") {
      if (lines.some((l) => l.kind === "phone" && l.refId === option.phone_unit_id)) {
        setNotice("This phone is already on the invoice.");
        return;
      }
      pendingFocus.current = fieldSelector(lines.length);
      setLines((current) => [...current, lineFromOption(option)]);
      return;
    }

    // Same accessory again: add one to the existing line
    const existing = lines.findIndex((l) => l.kind === "accessory" && l.refId === option.product_id);
    if (existing >= 0) {
      const line = lines[existing];
      const qty = WHOLE.test(line.quantity.trim()) ? Number(line.quantity.trim()) : 0;
      if (qty >= line.inStock) {
        setNotice(`Only ${line.inStock} of "${line.title}" in stock.`);
      } else {
        updateLine(existing, { quantity: String(qty + 1) });
      }
      pendingFocus.current = fieldSelector(existing, "quantity");
      return;
    }
    pendingFocus.current = fieldSelector(lines.length);
    setLines((current) => [...current, lineFromOption(option)]);
  }

  function updateLine(index: number, patch: Partial<SaleLine>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    pendingFocus.current = "add-item";
    setLines((current) => current.filter((_, i) => i !== index));
  }

  // ---------- Totals (display only; the database calculates the saved values) ----------

  const calcs = lines.map(calculate);
  const subtotal = calcs.reduce<bigint>((sum, c) => sum + (c.net ?? ZERO), ZERO);
  const discountCents = money(invoiceDiscount);
  const grandTotal =
    discountCents !== null && discountCents <= subtotal ? subtotal - discountCents : subtotal;
  const paidCents = money(paid);
  const remaining = paidCents !== null ? grandTotal - paidCents : grandTotal;

  // Estimated profit, only for users who may see cost
  let profit: bigint | null = null;
  let costMissing = false;
  if (seesCost) {
    profit = ZERO;
    lines.forEach((line, i) => {
      const c = calcs[i];
      if (line.cost === null || c.net === null || c.qty === null) {
        costMissing = true;
        return;
      }
      profit = (profit ?? ZERO) + (c.net - line.cost * BigInt(c.qty));
    });
    profit = (profit ?? ZERO) - (discountCents ?? ZERO);
  }

  // ---------- Validation ----------

  const reasons: string[] = [];
  if (lines.length === 0) reasons.push("Add at least one item.");
  calcs.forEach((c, i) => {
    if (c.problems.length) reasons.push(`Line ${i + 1}: ${c.problems.join(", ")}.`);
  });
  if (discountCents === null) reasons.push("Enter a valid invoice discount.");
  else if (discountCents > subtotal) reasons.push("Invoice discount cannot be more than the subtotal.");
  if (paidCents === null) reasons.push("Enter a valid amount for Paid now.");
  else if (paidCents > grandTotal) reasons.push("Paid now cannot be more than the grand total.");

  const needsCustomer = remaining > ZERO;
  const hasNewCustomer = customer.name.trim() !== "" && customer.phone.trim() !== "";
  if (needsCustomer && !customer.existing && !hasNewCustomer) {
    reasons.push("Customer name and phone are required when part of the amount remains unpaid.");
  }

  const canSave = reasons.length === 0 && !saving;

  // ---------- Save ----------

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);

    const payload: Record<string, unknown> = {
      discount: plainNumber(invoiceDiscount),
      paid_amount: plainNumber(paid),
      payment_method: method,
      notes: notes.trim() || null,
      items: lines.map((line) =>
        line.kind === "phone"
          ? {
              item_type: "phone",
              phone_unit_id: line.refId,
              unit_price: plainNumber(line.unitPrice),
              discount: plainNumber(line.discount),
              warranty_days: Number(line.warranty.trim() || "0"),
            }
          : {
              item_type: "accessory",
              product_id: line.refId,
              quantity: Number(line.quantity.trim()),
              unit_price: plainNumber(line.unitPrice),
              discount: plainNumber(line.discount),
              warranty_days: Number(line.warranty.trim() || "0"),
            }
      ),
    };
    if (customer.existing) {
      payload.customer_id = customer.existing.id;
    } else {
      if (customer.name.trim()) payload.customer_name = customer.name.trim();
      if (customer.phone.trim()) payload.customer_phone = customer.phone.trim();
    }

    try {
      const response = await createSale(payload);
      if (response.ok && response.result) {
        setResult(response.result);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setSaveError(response.error ?? "The sale could not be saved.");
      }
    } catch {
      setSaveError("The sale could not be saved. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setLines([]);
    setCustomer(emptyCustomer);
    setInvoiceDiscount("0");
    setMethod("cash");
    setPaid("0");
    setNotes("");
    setSaveError(null);
    setNotice(null);
    setResult(null);
    pendingFocus.current = "add-item";
  }

  // ---------- Keyboard ----------

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      void save();
      return;
    }
    if (event.defaultPrevented || event.shiftKey || event.altKey) return;
    const field = (event.target as HTMLElement).closest<HTMLElement>("[data-sale-field]");
    if (!field || !rootRef.current) return;

    event.preventDefault();
    const fields = Array.from(
      rootRef.current.querySelectorAll<HTMLElement>(fieldSelector(Number(field.dataset.line)))
    );
    const next = fields[fields.indexOf(field) + 1];
    if (next) next.focus();
    else addItemRef.current?.focus();
  }

  // ---------- Success panel ----------

  if (result) {
    // Values come straight from create_sale; remaining is the returned balance
    return (
      <section className={cardClass + " mx-auto max-w-xl text-center"}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint">
          <CheckCircle2 className="h-8 w-8 text-accent" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-ink">Sale saved</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Invoice{" "}
          <span className="font-semibold text-ink">{formatInvoiceNo(result.invoice_no)}</span>
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-3 text-left">
          {[
            ["Total", formatMoney(result.total, currency), "bg-aqua"],
            ["Paid", formatMoney(result.paid, currency), "bg-mint"],
            ["Remaining", formatMoney(result.balance, currency), "bg-peach"],
          ].map(([label, value, tone]) => (
            <div key={label} className={"rounded-2xl px-3 py-3 " + tone}>
              <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
              <dd className="mt-1 text-sm font-bold text-ink sm:text-base">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-col flex-wrap justify-center gap-2 sm:flex-row">
          <button type="button" onClick={resetAll} className={primaryButtonClass} autoFocus>
            <Plus className="h-4 w-4" />
            New sale
          </button>
          <Link href={`/sales/${result.sale_id}`} className={secondaryButtonClass}>
            <FileText className="h-4 w-4" />
            View invoice
          </Link>
          <Link href={`/sales/${result.sale_id}?print=1`} className={secondaryButtonClass}>
            <Printer className="h-4 w-4" />
            Print invoice
          </Link>
          <Link href="/sales" className={secondaryButtonClass}>
            Back to sales
          </Link>
        </div>
      </section>
    );
  }

  // ---------- Entry screen ----------

  const lineGrid =
    "grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[minmax(0,2.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] xl:items-center xl:gap-2";
  const headerCell = "text-xs font-bold uppercase tracking-wide text-ink-muted";
  const fieldLabel = "mb-1.5 block text-xs font-semibold text-ink-muted xl:sr-only";

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
        {/* Items */}
        <section className={cardClass + " space-y-4"}>
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-accent" />
            <h2 className="text-base font-bold text-ink">Items</h2>
          </div>

          <SaleItemSearch
            onPick={addItem}
            excludePhoneIds={new Set(lines.filter((l) => l.kind === "phone").map((l) => l.refId))}
            currency={currency}
            inputRef={addItemRef}
          />
          {notice && <Notice kind="error">{notice}</Notice>}

          {lines.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-6 py-10 text-center">
              <div className="relative mx-auto h-16 w-16">
                <div className="absolute inset-0 rounded-full bg-aqua" />
                <div className="absolute inset-2.5 flex items-center justify-center rounded-2xl border-2 border-ink bg-surface">
                  <ShoppingCart className="h-5 w-5 text-accent" />
                </div>
              </div>
              <p className="mt-3 text-sm font-bold text-ink">No items yet</p>
              <p className="mt-1 text-xs text-ink-muted">
                Scan an IMEI or type a model or accessory name above, then press Enter.
              </p>
            </div>
          ) : (
            <div>
              <div className={"hidden border-b border-line pb-2 xl:grid " + lineGrid}>
                <span className={headerCell}>Item</span>
                <span className={headerCell}>Qty</span>
                <span className={headerCell}>Unit price</span>
                <span className={headerCell}>Discount</span>
                <span className={headerCell}>Warranty</span>
                <span className={headerCell + " text-right"}>Line total</span>
                <span className="w-11" />
              </div>
              <div className="space-y-3 xl:space-y-0">
                {lines.map((line, index) => {
                  const c = calcs[index];
                  const n = index + 1;
                  return (
                    <div
                      key={line.key}
                      className="rounded-2xl border border-line bg-surface p-4 xl:rounded-none xl:border-0 xl:border-b xl:px-0 xl:py-3"
                    >
                      <div className={lineGrid}>
                        {/* Item (read only) */}
                        <div className="col-span-2 flex min-w-0 items-start gap-3 md:col-span-4 xl:col-span-1">
                          <span
                            className={
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                              (line.kind === "phone" ? "bg-aqua text-accent" : "bg-peach text-coral")
                            }
                          >
                            {line.kind === "phone" ? (
                              <Smartphone className="h-4 w-4" />
                            ) : (
                              <Headphones className="h-4 w-4" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{line.title}</span>
                            {line.detail && (
                              <span className="block truncate text-xs text-ink-muted">{line.detail}</span>
                            )}
                            {line.imei && (
                              <span className="block font-mono text-xs text-ink-muted">IMEI {line.imei}</span>
                            )}
                            {line.kind === "accessory" && (
                              <span className="block text-xs text-ink-muted">In stock: {line.inStock}</span>
                            )}
                            {c.belowCost && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-semibold text-ink">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber" />
                                Below purchase cost
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            aria-label={`Remove line ${n}`}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-danger-soft hover:text-danger xl:hidden"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div>
                          <span className={fieldLabel}>Qty</span>
                          {line.kind === "phone" ? (
                            <span className="flex min-h-11 items-center px-1 text-sm font-semibold text-ink">1</span>
                          ) : (
                            <input
                              data-sale-field=""
                              data-line={index}
                              data-field="quantity"
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              value={line.quantity}
                              onChange={(e) => updateLine(index, { quantity: e.target.value })}
                              aria-label={`Quantity, line ${n}`}
                              className={inputClass}
                            />
                          )}
                        </div>
                        <div>
                          <span className={fieldLabel}>Unit price ({currency})</span>
                          <input
                            data-sale-field=""
                            data-line={index}
                            data-field="price"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                            aria-label={`Unit price, line ${n}`}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <span className={fieldLabel}>Discount ({currency})</span>
                          <input
                            data-sale-field=""
                            data-line={index}
                            data-field="discount"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={line.discount}
                            onChange={(e) => updateLine(index, { discount: e.target.value })}
                            aria-label={`Discount, line ${n}`}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <span className={fieldLabel}>Warranty (days)</span>
                          <input
                            data-sale-field=""
                            data-line={index}
                            data-field="warranty"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={line.warranty}
                            onChange={(e) => updateLine(index, { warranty: e.target.value })}
                            aria-label={`Warranty days, line ${n}`}
                            className={inputClass}
                          />
                        </div>
                        <div className="flex flex-col justify-center xl:items-end">
                          <span className={fieldLabel}>Line total</span>
                          <span className="text-sm font-bold text-ink">
                            {c.net === null ? "—" : formatMoney(c.net, currency)}
                          </span>
                        </div>
                        <div className="hidden xl:block">
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            aria-label={`Remove line ${n}`}
                            title="Remove line"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {c.problems.length > 0 && (
                        <p className="mt-2 text-xs font-medium text-danger">
                          {c.problems.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Customer and notes */}
        <section className={cardClass + " space-y-4"}>
          <h2 className="text-base font-bold text-ink">Customer</h2>
          <CustomerPanel
            value={customer}
            onChange={setCustomer}
            currency={currency}
            required={needsCustomer}
          />
          <div>
            <label htmlFor="sale-notes" className={labelClass}>
              Notes (optional)
            </label>
            <textarea
              id="sale-notes"
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </div>
        </section>
      </div>

      {/* Footer: totals, payment and save */}
      <section className="sticky bottom-24 z-30 rounded-card border border-line bg-surface p-4 shadow-soft lg:bottom-3 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] lg:items-start">
          <div className="space-y-2">
            <dl className="grid grid-cols-3 gap-2 text-sm lg:grid-cols-1 lg:gap-1">
              <div className="flex flex-col lg:flex-row lg:justify-between">
                <dt className="text-xs text-ink-muted lg:text-sm">Subtotal</dt>
                <dd className="font-semibold text-ink">{formatMoney(subtotal, currency)}</dd>
              </div>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
                <dt className="text-xs text-ink-muted lg:text-sm">
                  <label htmlFor="sale-discount">Discount</label>
                </dt>
                <dd>
                  <input
                    id="sale-discount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={invoiceDiscount}
                    onChange={(e) => setInvoiceDiscount(e.target.value)}
                    className={inputClass + " min-h-11 lg:w-32 lg:text-right"}
                  />
                </dd>
              </div>
              <div className="flex flex-col lg:flex-row lg:justify-between">
                <dt className="text-xs text-ink-muted lg:text-sm">Grand total</dt>
                <dd className="text-base font-bold text-ink">{formatMoney(grandTotal, currency)}</dd>
              </div>
            </dl>
            {seesCost && profit !== null && lines.length > 0 && (
              <p className="text-xs text-ink-muted">
                Estimated profit:{" "}
                <span className="font-semibold text-ink">{formatMoney(profit, currency)}</span>
                {costMissing ? " (some costs unknown)" : ""}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sale-paid" className={labelClass}>
                Paid now ({currency})
              </label>
              <input
                id="sale-paid"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setPaid(centsToPlain(grandTotal))}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-mint px-3 text-xs font-semibold text-ink"
              >
                Paid in full
              </button>
            </div>
            <div>
              <label htmlFor="sale-method" className={labelClass}>
                Payment method
              </label>
              <select
                id="sale-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as "cash" | "bank")}
                className={inputClass}
              >
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
              <div
                className={
                  "mt-2 flex min-h-11 items-center justify-between rounded-2xl px-4 " +
                  (remaining > ZERO ? "bg-peach" : "bg-mint")
                }
              >
                <span className="text-xs font-semibold text-ink-muted">Remaining</span>
                <span className="text-sm font-bold text-ink">{formatMoney(remaining, currency)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className={primaryButtonClass + " min-h-14 w-full text-base"}
            >
              {saving ? "Saving..." : "Save sale"}
            </button>
            <p className="text-center text-xs text-ink-muted">Shortcut: Ctrl + Enter</p>
            {reasons.length > 0 && (
              <ul className="space-y-0.5 text-xs text-ink-muted" aria-live="polite">
                {reasons.slice(0, 4).map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
                {reasons.length > 4 && <li>• and {reasons.length - 4} more</li>}
              </ul>
            )}
            {saveError && <Notice kind="error">{saveError}</Notice>}
          </div>
        </div>
      </section>
    </div>
  );
}
