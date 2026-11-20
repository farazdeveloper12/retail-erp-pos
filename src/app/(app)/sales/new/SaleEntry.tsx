"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Headphones,
  PackagePlus,
  PackageSearch,
  Pencil,
  Plus,
  Printer,
  Repeat,
  ShoppingCart,
  Smartphone,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import SupplierPicker, { type PickedSupplier } from "@/components/SupplierPicker";
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
  createQuickSale,
  type SaleItemOption,
  type SaleResult,
} from "@/app/(app)/sales/new/actions";
import { loadPurchaseCatalog, type CatalogBrand } from "@/app/(app)/purchases/new/actions";
import SaleItemSearch from "@/app/(app)/sales/new/SaleItemSearch";
import CustomerPanel, { type CustomerValue } from "@/app/(app)/sales/new/CustomerPanel";
import QuickSourceCard, { type SourcedDraft } from "@/app/(app)/sales/new/QuickSourceCard";
import TradeInCard from "@/app/(app)/sales/new/TradeInCard";
import { EMPTY_TRADE_IN, cleanImei, tradeInPayload, type TradeInDraft } from "@/lib/trade-in";

// ---------- Types and helpers ----------

type SourceInfo = {
  modelId: string;
  variantId: string;
  colorId: string | null;
  condition: string;
};

type SaleLine = {
  key: string;
  // "unstocked": not in stock, bought from another shop on the spot. It never
  // touches inventory; title is the typed name, imei an optional IMEI/serial
  // and sourceCost the cost price.
  kind: "phone" | "accessory" | "unstocked";
  refId: string; // phone_unit_id or product_id (for sourced phones and unstocked lines: unused)
  title: string;
  detail: string;
  imei: string | null;
  inStock: number;
  quantity: string;
  unitPrice: string;
  discount: string;
  warranty: string;
  // In-stock lines: present only for users who may see cost; never sent back
  cost: bigint | null;
  // Lines bought from a supplier in the same save
  sourced: boolean;
  sourceCost: string;
  source: SourceInfo | null;
};

const ZERO = BigInt(0);
const WHOLE = /^\d+$/;
const MAX_SOURCED_QTY = 100000;
const MAX_UNSTOCKED_QTY = 10000;

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `line-${keyCounter}`;
}

function lineFromOption(option: SaleItemOption): SaleLine {
  const price = toCents(option.sale_price);
  const cost = "cost" in option ? toCents(option.cost) : null;
  const base = {
    key: newKey(),
    quantity: "1",
    unitPrice: price === null ? "" : centsToPlain(price),
    discount: "",
    cost,
    sourced: false,
    sourceCost: "",
    source: null,
  };
  if (option.kind === "phone") {
    return {
      ...base,
      kind: "phone",
      refId: option.phone_unit_id,
      title: option.model,
      detail: [option.storage, option.color, option.condition].filter(Boolean).join(" · "),
      imei: option.imei,
      inStock: 1,
      warranty: "7",
    };
  }
  return {
    ...base,
    kind: "accessory",
    refId: option.product_id,
    title: option.name,
    detail: "",
    imei: null,
    inStock: option.in_stock,
    warranty: "",
  };
}

function lineFromDraft(draft: SourcedDraft): SaleLine {
  const base = {
    key: newKey(),
    unitPrice: draft.salePrice,
    discount: "",
    cost: null,
    sourced: true,
    sourceCost: draft.cost,
  };
  if (draft.kind === "phone") {
    return {
      ...base,
      kind: "phone",
      refId: "",
      title: draft.title,
      detail: draft.detail,
      imei: draft.imei,
      inStock: 1,
      quantity: "1",
      warranty: "7",
      source: {
        modelId: draft.modelId,
        variantId: draft.variantId,
        colorId: draft.colorId,
        condition: draft.condition,
      },
    };
  }
  return {
    ...base,
    kind: "accessory",
    refId: draft.productId,
    title: draft.title,
    detail: "",
    imei: null,
    inStock: MAX_SOURCED_QTY,
    quantity: draft.quantity,
    warranty: "",
    source: null,
  };
}

function newUnstockedLine(): SaleLine {
  return {
    key: newKey(),
    kind: "unstocked",
    refId: "",
    title: "",
    detail: "",
    imei: null,
    inStock: MAX_UNSTOCKED_QTY,
    quantity: "1",
    unitPrice: "",
    discount: "",
    warranty: "",
    cost: null,
    sourced: false,
    sourceCost: "",
    source: null,
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
  net: bigint | null;
  cost: bigint | null;
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
    problems.push(
      line.sourced ? "quantity must be a whole number of 1 or more" : `quantity must be from 1 to ${line.inStock}`
    );
  }

  if (line.kind === "unstocked") {
    const name = line.title.trim();
    if (name === "") problems.push("enter the item name");
    else if (name.length > 200) problems.push("the item name can have at most 200 characters");
    if ((line.imei ?? "").trim().length > 40) problems.push("the IMEI or serial can have at most 40 characters");
  }

  const unit = line.unitPrice.trim() === "" ? null : money(line.unitPrice);
  if (unit === null) problems.push("enter a valid unit price");
  const discount = money(line.discount);
  if (discount === null) problems.push("enter a valid discount");

  const warranty = line.warranty.trim() === "" ? "0" : line.warranty.trim();
  if (!WHOLE.test(warranty) || Number(warranty) > 3650) {
    problems.push("warranty must be 0 to 3650 days");
  }

  // Sourced and unstocked lines carry the cost the user typed
  let cost = line.cost;
  if (line.sourced || line.kind === "unstocked") {
    cost = isValidMoneyInput(line.sourceCost) ? toCents(line.sourceCost) : null;
    if (cost === null) problems.push(line.sourced ? "enter a valid purchase price" : "enter a valid cost price");
  }

  const gross = qty !== null && unit !== null ? unit * BigInt(qty) : null;
  let net: bigint | null = null;
  if (gross !== null && discount !== null) {
    if (discount > gross) problems.push("discount cannot be more than the line amount");
    else net = gross - discount;
  }

  const belowCost = cost !== null && net !== null && qty !== null && net < cost * BigInt(qty);
  return { qty, net, cost, problems, belowCost };
}

const emptyCustomer: CustomerValue = { existing: null, name: "", phone: "" };

// ---------- Main component ----------

export default function SaleEntry({
  currency,
  seesCost,
  canSource,
  canAddModels,
  canCreateProducts,
  canTradeIn,
}: {
  currency: string;
  seesCost: boolean;
  canSource: boolean;
  canAddModels: boolean;
  canCreateProducts: boolean;
  canTradeIn: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const addItemRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<string | null>(null);

  const [lines, setLines] = useState<SaleLine[]>([]);
  const [customer, setCustomer] = useState<CustomerValue>(emptyCustomer);
  const [invoiceDiscount, setInvoiceDiscount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [paid, setPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);

  // Not-in-stock items bought from a supplier
  const [sourcingOpen, setSourcingOpen] = useState(false);
  const [sourcingKey, setSourcingKey] = useState(0);
  const [catalog, setCatalog] = useState<CatalogBrand[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [supplierPaid, setSupplierPaid] = useState("");
  const [supplierMethod, setSupplierMethod] = useState<"cash" | "bank">("cash");

  // The customer's old phone (trade-in): its value pays part of the invoice
  const [tradeIn, setTradeIn] = useState<TradeInDraft | null>(null);
  const [tradeInOpen, setTradeInOpen] = useState(false);
  const [tradeInKey, setTradeInKey] = useState(0);

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
      if (lines.some((l) => l.kind === "phone" && !l.sourced && l.refId === option.phone_unit_id)) {
        setNotice("This phone is already on the invoice.");
        return;
      }
      pendingFocus.current = fieldSelector(lines.length, "price");
      setLines((current) => [...current, lineFromOption(option)]);
      return;
    }

    // Same in-stock accessory again: add one to the existing line
    const existing = lines.findIndex(
      (l) => l.kind === "accessory" && !l.sourced && l.refId === option.product_id
    );
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
    pendingFocus.current = fieldSelector(lines.length, "quantity");
    setLines((current) => [...current, lineFromOption(option)]);
  }

  // A free line for an item that is not in stock (no stock, purchase or supplier)
  function addUnstocked() {
    setNotice(null);
    pendingFocus.current = fieldSelector(lines.length, "name");
    setLines((current) => [...current, newUnstockedLine()]);
  }

  function updateLine(index: number, patch: Partial<SaleLine>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    pendingFocus.current = "add-item";
    setLines((current) => current.filter((_, i) => i !== index));
  }

  async function loadCatalog() {
    setCatalogLoading(true);
    try {
      const fresh = await loadPurchaseCatalog();
      if (fresh.ok) setCatalog(fresh.brands);
      else setNotice(fresh.error ?? "The models could not be loaded.");
    } catch {
      setNotice("The models could not be loaded.");
    } finally {
      setCatalogLoading(false);
    }
  }

  function openSourcing() {
    setNotice(null);
    setSourcingKey((k) => k + 1);
    setSourcingOpen(true);
    if (!catalog && !catalogLoading) void loadCatalog();
  }

  function closeSourcing() {
    setSourcingOpen(false);
    pendingFocus.current = "add-item";
  }

  function openTradeIn() {
    setNotice(null);
    setTradeInKey((k) => k + 1);
    setTradeInOpen(true);
    if (!catalog && !catalogLoading) void loadCatalog();
  }

  // The POS customer is the seller unless the card says otherwise
  function tradeInStart(): TradeInDraft {
    if (tradeIn) return tradeIn;
    return {
      ...EMPTY_TRADE_IN,
      customerId: customer.existing?.id ?? null,
      sellerName: customer.existing?.name ?? customer.name,
      sellerPhone: customer.existing?.phone ?? customer.phone,
    };
  }

  function saveTradeIn(draft: TradeInDraft) {
    setTradeIn(draft);
    setTradeInOpen(false);
    pendingFocus.current = "add-item";
  }

  function addSourced(draft: SourcedDraft) {
    pendingFocus.current = fieldSelector(lines.length, "price");
    setLines((current) => [...current, lineFromDraft(draft)]);
    setSourcingOpen(false);
  }

  // ---------- Totals (display only; the database calculates the saved values) ----------

  const calcs = lines.map(calculate);
  const subtotal = calcs.reduce<bigint>((sum, c) => sum + (c.net ?? ZERO), ZERO);
  const discountCents = money(invoiceDiscount);
  const grandTotal =
    discountCents !== null && discountCents <= subtotal ? subtotal - discountCents : subtotal;
  const paidCents = money(paid);
  const tradeInCents = tradeIn ? (toCents(tradeIn.price) ?? ZERO) : ZERO;
  const remaining = (paidCents !== null ? grandTotal - paidCents : grandTotal) - tradeInCents;

  // "Brand Model 128 GB" of the trade-in phone, from the loaded catalog
  let tradeInLabel = "Old phone";
  if (tradeIn && catalog) {
    for (const brand of catalog) {
      const model = brand.models.find((m) => m.id === tradeIn.modelId);
      if (model) {
        const variant = model.variants.find((v) => v.id === tradeIn.variantId);
        tradeInLabel = `${brand.name} ${model.name}${variant ? ` ${variant.storage_gb} GB` : ""}`;
        break;
      }
    }
  }

  const hasSourced = lines.some((l) => l.sourced);
  const sourcedCost = lines.reduce<bigint>((sum, line, i) => {
    const c = calcs[i];
    return line.sourced && c.cost !== null && c.qty !== null ? sum + c.cost * BigInt(c.qty) : sum;
  }, ZERO);
  const supplierPaidCents = money(supplierPaid);
  const supplierBalance = sourcedCost - (supplierPaidCents ?? ZERO);

  // Estimated profit, only for users who may see cost
  let profit: bigint | null = null;
  let costMissing = false;
  if (seesCost) {
    let sum = ZERO;
    calcs.forEach((c) => {
      if (c.cost === null || c.net === null || c.qty === null) {
        costMissing = true;
        return;
      }
      sum += c.net - c.cost * BigInt(c.qty);
    });
    profit = sum - (discountCents ?? ZERO);
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
  else if (tradeIn && paidCents + tradeInCents > grandTotal) {
    reasons.push("The trade-in value plus Paid now cannot be more than the grand total.");
  }

  // Unpaid money always needs a known customer
  const needsCustomer = paidCents === null || remaining > ZERO;
  const hasNewCustomer = customer.name.trim() !== "" && customer.phone.trim() !== "";
  // A trade-in always has the seller's name and phone
  if (needsCustomer && !customer.existing && !hasNewCustomer && !tradeIn) {
    reasons.push("Customer name and phone are required when part of the amount remains unpaid.");
  }

  if (hasSourced) {
    if (!supplier) reasons.push("Choose a supplier for the items that are not in stock.");
    if (supplierPaidCents === null) reasons.push("Enter a valid amount for Paid to supplier now.");
    else if (supplierPaidCents > sourcedCost) {
      reasons.push("Paid to supplier cannot be more than the cost of the sourced items.");
    }
  }

  const canSave = reasons.length === 0 && !saving;

  // ---------- Save ----------

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);

    const sale: Record<string, unknown> = {
      discount: plainNumber(invoiceDiscount),
      paid_amount: plainNumber(paid),
      payment_method: method,
      notes: notes.trim() || null,
      items: lines.map((line) => {
        const common = {
          unit_price: plainNumber(line.unitPrice),
          discount: plainNumber(line.discount),
          warranty_days: Number(line.warranty.trim() || "0"),
        };
        if (line.kind === "phone" && line.sourced && line.source) {
          return {
            item_type: "phone",
            sourced: true,
            model_id: line.source.modelId,
            variant_id: line.source.variantId,
            color_id: line.source.colorId,
            condition: line.source.condition,
            imei: line.imei,
            unit_cost: plainNumber(line.sourceCost),
            ...common,
          };
        }
        if (line.kind === "phone") {
          return { item_type: "phone", phone_unit_id: line.refId, ...common };
        }
        if (line.kind === "unstocked") {
          return {
            item_type: "unstocked",
            description: line.title.trim(),
            imei: line.imei?.trim() || null,
            quantity: Number(line.quantity.trim()),
            unit_cost: plainNumber(line.sourceCost),
            ...common,
          };
        }
        return {
          item_type: "accessory",
          product_id: line.refId,
          quantity: Number(line.quantity.trim()),
          ...(line.sourced ? { sourced: true, unit_cost: plainNumber(line.sourceCost) } : {}),
          ...common,
        };
      }),
    };
    // Name and phone are sent with an existing customer too, so the sale
    // keeps a snapshot of them for the invoice.
    if (customer.existing) sale.customer_id = customer.existing.id;
    if (customer.name.trim()) sale.customer_name = customer.name.trim();
    if (customer.phone.trim()) sale.customer_phone = customer.phone.trim();

    const payload: Record<string, unknown> = { sale };
    if (tradeIn) payload.trade_in = tradeInPayload(tradeIn);
    if (hasSourced && supplier) {
      payload.supplier_id = supplier.id;
      payload.supplier_paid_amount = plainNumber(supplierPaid);
      if ((supplierPaidCents ?? ZERO) > ZERO) payload.supplier_payment_method = supplierMethod;
    }

    try {
      const response = await createQuickSale(payload);
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
    setInvoiceDiscount("");
    setMethod("cash");
    setPaid("");
    setNotes("");
    setSaveError(null);
    setNotice(null);
    setResult(null);
    setSourcingOpen(false);
    setSupplier(null);
    setSupplierPaid("");
    setSupplierMethod("cash");
    setTradeIn(null);
    setTradeInOpen(false);
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
    // Values come straight from create_quick_sale; remaining is the returned balance
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
        {result.trade_in_id && (
          <p className="mt-4 flex items-start justify-center gap-2 rounded-2xl bg-lavender px-4 py-3 text-left text-sm text-ink">
            <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-purple" />
            <span>
              Trade-in of {formatMoney(result.trade_in ?? 0, currency)} taken off the invoice; the old phone is in
              stock as Used.{" "}
              <Link href={`/purchases/from-customers/${result.trade_in_id}`} className="font-semibold text-accent">
                Open the trade-in slip
              </Link>
            </span>
          </p>
        )}
        {result.purchase_no !== undefined && result.purchase_no !== null && (
          <p className="mt-4 flex items-start justify-center gap-2 rounded-2xl bg-lavender px-4 py-3 text-left text-sm text-ink">
            <Truck className="mt-0.5 h-4 w-4 shrink-0 text-purple" />
            <span>
              Purchase #{result.purchase_no} was created from the supplier.
              {result.supplier_balance !== undefined && result.supplier_balance !== null && (
                <>
                  {" "}
                  Supplier balance:{" "}
                  <span className="font-semibold">{formatMoney(result.supplier_balance, currency)}</span>
                </>
              )}
            </span>
          </p>
        )}
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

  const usedImeis = new Set(lines.map((l) => l.imei).filter((i): i is string => Boolean(i)));
  const lineGrid =
    "grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[minmax(0,2.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] xl:items-center xl:gap-2";
  const headerCell = "text-xs font-bold uppercase tracking-wide text-ink-muted";
  const fieldLabel = "mb-1.5 block text-xs font-semibold text-ink-muted xl:sr-only";

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
        {/* Items */}
        <section className={cardClass + " space-y-4"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-accent" />
              <h2 className="text-base font-bold text-ink">Items</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addUnstocked} className={secondaryButtonClass}>
                <PackageSearch className="h-4 w-4" />
                Item not in stock
              </button>
              {canTradeIn && !tradeIn && (
                <button type="button" onClick={openTradeIn} className={secondaryButtonClass}>
                  <Repeat className="h-4 w-4" />
                  Trade-in
                </button>
              )}
            </div>
          </div>

          <SaleItemSearch
            onPick={addItem}
            onNotInStock={canSource ? openSourcing : undefined}
            excludePhoneIds={
              new Set(lines.filter((l) => l.kind === "phone" && !l.sourced).map((l) => l.refId))
            }
            currency={currency}
            inputRef={addItemRef}
          />
          {notice && <Notice kind="error">{notice}</Notice>}

          {sourcingOpen && canSource && (
            <QuickSourceCard
              key={sourcingKey}
              brands={catalog}
              loadingCatalog={catalogLoading}
              onReloadCatalog={() => void loadCatalog()}
              canAddModels={canAddModels}
              canCreateProducts={canCreateProducts}
              currency={currency}
              usedImeis={usedImeis}
              onAdd={addSourced}
              onClose={closeSourcing}
            />
          )}

          {tradeInOpen && canTradeIn && (
            <TradeInCard
              key={tradeInKey}
              initial={tradeInStart()}
              brands={catalog}
              loadingCatalog={catalogLoading}
              onReloadCatalog={loadCatalog}
              currency={currency}
              usedImeis={usedImeis}
              onSave={saveTradeIn}
              onClose={() => setTradeInOpen(false)}
            />
          )}

          {tradeIn && !tradeInOpen && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-lavender/40 px-4 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lavender text-purple">
                  <Repeat className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">Trade-in: {tradeInLabel}</span>
                  <span className="block font-mono text-xs text-ink-muted">IMEI {cleanImei(tradeIn.imei)}</span>
                  <span className="block text-xs text-ink-muted">
                    Grade {tradeIn.grade} · from {tradeIn.sellerName.trim()}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink">-{formatMoney(tradeInCents, currency)}</span>
                <button
                  type="button"
                  onClick={openTradeIn}
                  aria-label="Edit trade-in"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-surface"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTradeIn(null)}
                  aria-label="Remove trade-in"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

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
                        {/* Item (read only, with the purchase price for sourced lines) */}
                        <div className="col-span-2 flex min-w-0 items-start gap-3 md:col-span-4 xl:col-span-1">
                          <span
                            className={
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                              (line.kind === "phone"
                                ? "bg-aqua text-accent"
                                : line.kind === "unstocked"
                                  ? "bg-lavender text-purple"
                                  : "bg-peach text-coral")
                            }
                          >
                            {line.kind === "phone" ? (
                              <Smartphone className="h-4 w-4" />
                            ) : line.kind === "unstocked" ? (
                              <PackageSearch className="h-4 w-4" />
                            ) : (
                              <Headphones className="h-4 w-4" />
                            )}
                          </span>
                          {line.kind === "unstocked" ? (
                            <span className="min-w-0 flex-1 space-y-2">
                              <input
                                data-sale-field=""
                                data-line={index}
                                data-field="name"
                                type="text"
                                autoComplete="off"
                                maxLength={200}
                                placeholder="Item name"
                                value={line.title}
                                onChange={(e) => updateLine(index, { title: e.target.value })}
                                aria-label={`Item name, line ${n}`}
                                className={inputClass}
                              />
                              <span className="grid gap-2 sm:grid-cols-2">
                                <input
                                  data-sale-field=""
                                  data-line={index}
                                  data-field="cost"
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  placeholder={`Cost price (${currency})`}
                                  value={line.sourceCost}
                                  onChange={(e) => updateLine(index, { sourceCost: e.target.value })}
                                  aria-label={`Cost price, line ${n}`}
                                  className={inputClass}
                                />
                                <input
                                  data-sale-field=""
                                  data-line={index}
                                  data-field="serial"
                                  type="text"
                                  autoComplete="off"
                                  maxLength={40}
                                  placeholder="IMEI / serial (optional)"
                                  value={line.imei ?? ""}
                                  onChange={(e) => updateLine(index, { imei: e.target.value })}
                                  aria-label={`IMEI or serial number, line ${n}`}
                                  className={inputClass + " font-mono"}
                                />
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-lavender px-2 py-0.5 text-xs font-semibold text-ink">
                                Not in stock · no stock change
                              </span>
                              {c.belowCost && (
                                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-semibold text-ink">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber" />
                                  Below cost price
                                </span>
                              )}
                            </span>
                          ) : (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{line.title}</span>
                            {line.detail && (
                              <span className="block truncate text-xs text-ink-muted">{line.detail}</span>
                            )}
                            {line.imei && (
                              <span className="block font-mono text-xs text-ink-muted">IMEI {line.imei}</span>
                            )}
                            {line.kind === "accessory" && !line.sourced && (
                              <span className="block text-xs text-ink-muted">In stock: {line.inStock}</span>
                            )}
                            {line.sourced && (
                              <span className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-lavender px-2 py-0.5 text-xs font-semibold text-ink">
                                  <PackagePlus className="h-3.5 w-3.5 text-purple" />
                                  From supplier
                                </span>
                                <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                                  Purchase price
                                  <input
                                    data-sale-field=""
                                    data-line={index}
                                    data-field="cost"
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    value={line.sourceCost}
                                    onChange={(e) => updateLine(index, { sourceCost: e.target.value })}
                                    aria-label={`Purchase price, line ${n}`}
                                    className="min-h-11 w-28 rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                                  />
                                </label>
                              </span>
                            )}
                            {c.belowCost && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-semibold text-ink">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber" />
                                Below purchase cost
                              </span>
                            )}
                          </span>
                          )}
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
                            placeholder="0"
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
                            placeholder="0"
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
                        <p className="mt-2 text-xs font-medium text-danger">{c.problems.join(", ")}</p>
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

      {/* Supplier for the items that are not in stock */}
      {hasSourced && (
        <section className={cardClass + " space-y-4"}>
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-purple" />
            <h2 className="text-base font-bold text-ink">Supplier</h2>
            <span className="text-xs text-ink-muted">for the items that are not in stock</span>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
            <div>
              <p className={labelClass}>Supplier</p>
              {supplier ? (
                <div className="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-line-strong bg-surface-muted px-4">
                  <span className="truncate text-sm font-semibold text-ink">{supplier.name}</span>
                  <button
                    type="button"
                    onClick={() => setSupplier(null)}
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent"
                  >
                    <X className="h-3.5 w-3.5" />
                    Change
                  </button>
                </div>
              ) : (
                <SupplierPicker
                  canCreate
                  label="Supplier"
                  placeholder="Search or add a supplier..."
                  onSelect={setSupplier}
                />
              )}
            </div>
            <div>
              <label htmlFor="supplier-paid" className={labelClass}>
                Paid to supplier now ({currency})
              </label>
              <input
                id="supplier-paid"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={supplierPaid}
                onChange={(e) => setSupplierPaid(e.target.value)}
                className={inputClass}
              />
              {(supplierPaidCents ?? ZERO) > ZERO && (
                <select
                  aria-label="Supplier payment method"
                  value={supplierMethod}
                  onChange={(e) => setSupplierMethod(e.target.value as "cash" | "bank")}
                  className={inputClass + " mt-2"}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </select>
              )}
            </div>
            <dl className="space-y-1 rounded-2xl bg-lavender px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Cost of sourced items</dt>
                <dd className="font-semibold text-ink">{formatMoney(sourcedCost, currency)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Supplier balance</dt>
                <dd className="font-bold text-ink">{formatMoney(supplierBalance, currency)}</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

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
                    placeholder="0"
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
              {tradeIn && (
                <div className="flex flex-col lg:flex-row lg:justify-between">
                  <dt className="text-xs text-ink-muted lg:text-sm">Trade-in</dt>
                  <dd className="font-semibold text-ink">-{formatMoney(tradeInCents, currency)}</dd>
                </div>
              )}
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
                placeholder="0"
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() =>
                  setPaid(centsToPlain(grandTotal > tradeInCents ? grandTotal - tradeInCents : ZERO))
                }
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
