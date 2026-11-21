"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Headphones,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import ProductPicker, { type PickedProduct } from "@/components/ProductPicker";
import SupplierPicker, { type PickedSupplier } from "@/components/SupplierPicker";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import {
  centsToPlain,
  cleanMoneyInput,
  formatMoney,
  isValidMoneyInput,
  toCents,
} from "@/lib/money";
import {
  checkImeisInStock,
  getProductSalePrice,
  loadPurchaseCatalog,
  savePurchase,
  type CatalogBrand,
  type PurchaseResult,
} from "@/app/(app)/purchases/new/actions";
import PhoneModelSearch from "@/components/phone/PhoneModelSearch";
import QuickAddModelForm from "@/components/phone/QuickAddModelForm";
import { ColorPicker, PtaSelect, RamPicker, StoragePicker } from "@/components/phone/PhoneOptionPickers";
import {
  EMPTY_SPEC,
  buildPhoneIndex,
  isApple,
  specPayload,
  specProblem,
  type PhoneSpec,
} from "@/lib/phone-catalog";
import { showsPta } from "@/lib/pta";
import ImeiInput from "@/app/(app)/purchases/new/ImeiInput";

// ---------- Types and helpers ----------

type Condition = "new" | "used" | "open_box" | "refurbished";

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: "new", label: "New" },
  { value: "used", label: "Used" },
  { value: "open_box", label: "Open box" },
  { value: "refurbished", label: "Refurbished" },
];

type PhoneRow = {
  key: string;
  // Model, storage, RAM and colour; missing options are created when saving
  spec: PhoneSpec;
  pta: string; // "" = not known
  condition: Condition;
  imeis: string[];
  unitCost: string;
  salePrice: string;
};

type AccessoryRow = {
  key: string;
  product: PickedProduct | null;
  quantity: string;
  unitCost: string;
  salePrice: string;
};

type Group = "header" | "phones" | "accessories";

const IMEI_PATTERN = /^\d{15}$/;
const QUANTITY_PATTERN = /^\d+$/;
const ZERO = BigInt(0);

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `row-${keyCounter}`;
}

function emptyPhone(): PhoneRow {
  return {
    key: newKey(),
    spec: EMPTY_SPEC,
    pta: "",
    condition: "new",
    imeis: [],
    unitCost: "",
    salePrice: "",
  };
}

function emptyAccessory(): AccessoryRow {
  return { key: newKey(), product: null, quantity: "1", unitCost: "", salePrice: "" };
}

function isPhoneEmpty(row: PhoneRow) {
  return !row.spec.modelId && row.imeis.length === 0 && !row.unitCost.trim() && !row.salePrice.trim();
}

function isAccessoryEmpty(row: AccessoryRow) {
  return !row.product && !row.unitCost.trim() && !row.salePrice.trim();
}

function moneyNumber(value: string): number {
  return Number(cleanMoneyInput(value));
}

function lineTotal(unitCost: string, quantity: number): bigint | null {
  if (!isValidMoneyInput(unitCost)) return null;
  return (toCents(unitCost) ?? ZERO) * BigInt(quantity);
}

function focusCell(cell: Element | null) {
  if (!cell) return;
  const target = cell.matches("input, select, textarea, button")
    ? cell
    : cell.querySelector("input, select, textarea, button");
  (target as HTMLElement | null)?.focus();
}

// A labelled grid cell. The label is visible on cards and hidden in the
// laptop table (where the column header shows it).
function Cell({
  label,
  group,
  row,
  col,
  className = "",
  showLabel = false,
  children,
}: {
  label: string;
  group: Group;
  row: number;
  col: string;
  className?: string;
  showLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-cell=""
      data-group={group}
      data-row={row}
      data-col={col}
      className={className}
    >
      <span
        className={
          "mb-1.5 block text-xs font-semibold text-ink-muted " +
          (showLabel ? "" : "xl:sr-only")
        }
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function RowActions({
  onCopy,
  onRemove,
  label,
}: {
  onCopy: () => void;
  onRemove: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        title="Copy row"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <Copy className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        title="Remove row"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-danger-soft hover:text-danger"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------- Main component ----------

export default function PurchaseEntry({
  initialBrands,
  canAddModels,
  canCreateProducts,
  currency,
  region = "PK",
  today,
}: {
  initialBrands: CatalogBrand[];
  canAddModels: boolean;
  canCreateProducts: boolean;
  currency: string;
  // "PK" (Pakistan) or "AE" (UAE): decides PTA, phone and ID formats
  region?: string;
  today: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const stockRequest = useRef(0);

  // Catalog
  const [brands, setBrands] = useState(initialBrands);
  const [reloading, setReloading] = useState(false);
  const [reloadMessage, setReloadMessage] = useState<string | null>(null);

  // Header
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [date, setDate] = useState(today);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [extraCost, setExtraCost] = useState("");
  const [notes, setNotes] = useState("");

  // Lines
  const [phones, setPhones] = useState<PhoneRow[]>(() => [emptyPhone()]);
  const [accessories, setAccessories] = useState<AccessoryRow[]>(() => [emptyAccessory()]);
  const [inStock, setInStock] = useState<Set<string>>(() => new Set());

  // Payment and saving
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"" | "cash" | "bank">("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseResult | null>(null);

  // Type-ahead search over every brand, model and storage option
  const phoneIndex = useMemo(() => buildPhoneIndex(brands), [brands]);
  // Row whose missing model is being added right now
  const [quickAdd, setQuickAdd] = useState<{ row: number; query: string } | null>(null);

  // Focus a cell after rows were added or changed
  useEffect(() => {
    if (!pendingFocus.current || !rootRef.current) return;
    focusCell(rootRef.current.querySelector(pendingFocus.current));
    pendingFocus.current = null;
  });

  // Check (debounced) whether any entered IMEI is already in stock
  const imeiKey = phones.flatMap((row) => row.imeis).join(",");
  useEffect(() => {
    if (!imeiKey) return;
    const list = imeiKey.split(",");
    const id = ++stockRequest.current;
    const timer = setTimeout(async () => {
      let found: string[] = [];
      try {
        found = await checkImeisInStock(list);
      } catch {
        found = [];
      }
      if (id === stockRequest.current) setInStock(new Set(found));
    }, 400);
    return () => clearTimeout(timer);
  }, [imeiKey]);

  function cellSelector(group: Group, row: number, col?: string) {
    return `[data-cell][data-group="${group}"][data-row="${row}"]${col ? `[data-col="${col}"]` : ""}`;
  }

  // ---------- Row updates ----------

  function updatePhone(index: number, patch: Partial<PhoneRow>) {
    setPhones((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateSpec(index: number, patch: Partial<PhoneSpec>) {
    setPhones((rows) => rows.map((row, i) => (i === index ? { ...row, spec: { ...row.spec, ...patch } } : row)));
  }

  function addPhoneRow() {
    pendingFocus.current = cellSelector("phones", phones.length, "model");
    setPhones((rows) => [...rows, emptyPhone()]);
  }

  function copyPhoneRow(index: number) {
    const source = phones[index];
    pendingFocus.current = cellSelector("phones", index + 1, "imei");
    setPhones((rows) => [
      ...rows.slice(0, index + 1),
      { ...source, key: newKey(), imeis: [] },
      ...rows.slice(index + 1),
    ]);
  }

  function removePhoneRow(index: number) {
    setPhones((rows) =>
      rows.length === 1 ? [emptyPhone()] : rows.filter((_, i) => i !== index)
    );
  }

  // Validates and adds IMEIs to a row. Returns a message for rejected ones.
  function addImeis(index: number, values: string[]): string | null {
    const used = new Set(phones.flatMap((row) => row.imeis));
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const value of values) {
      if (!IMEI_PATTERN.test(value)) {
        rejected.push(`${value} (must be 15 digits)`);
      } else if (used.has(value) || accepted.includes(value)) {
        rejected.push(`${value} (already in this purchase)`);
      } else {
        accepted.push(value);
      }
    }
    if (accepted.length > 0) {
      setPhones((rows) =>
        rows.map((row, i) => (i === index ? { ...row, imeis: [...row.imeis, ...accepted] } : row))
      );
    }
    if (rejected.length === 0) return null;
    const shown = rejected.slice(0, 2).join(", ");
    return rejected.length > 2
      ? `Rejected: ${shown} and ${rejected.length - 2} more`
      : `Rejected: ${shown}`;
  }

  function removeImei(index: number, imei: string) {
    setPhones((rows) =>
      rows.map((row, i) =>
        i === index ? { ...row, imeis: row.imeis.filter((value) => value !== imei) } : row
      )
    );
  }

  function updateAccessory(index: number, patch: Partial<AccessoryRow>) {
    setAccessories((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function selectProduct(index: number, product: PickedProduct) {
    pendingFocus.current = cellSelector("accessories", index, "quantity");
    updateAccessory(index, { product });
    if (accessories[index]?.salePrice.trim()) return;
    try {
      const price = await getProductSalePrice(product.id);
      const cents = toCents(price);
      if (cents !== null) {
        setAccessories((rows) =>
          rows.map((row, i) =>
            i === index && !row.salePrice.trim() ? { ...row, salePrice: centsToPlain(cents) } : row
          )
        );
      }
    } catch {
      // No saved sale price; the field stays empty
    }
  }

  function addAccessoryRow() {
    pendingFocus.current = cellSelector("accessories", accessories.length, "product");
    setAccessories((rows) => [...rows, emptyAccessory()]);
  }

  function copyAccessoryRow(index: number) {
    const source = accessories[index];
    pendingFocus.current = cellSelector("accessories", index + 1, "quantity");
    setAccessories((rows) => [
      ...rows.slice(0, index + 1),
      { ...source, key: newKey() },
      ...rows.slice(index + 1),
    ]);
  }

  function removeAccessoryRow(index: number) {
    setAccessories((rows) =>
      rows.length === 1 ? [emptyAccessory()] : rows.filter((_, i) => i !== index)
    );
  }

  async function reloadModels(): Promise<void> {
    setReloading(true);
    setReloadMessage(null);
    try {
      const fresh = await loadPurchaseCatalog();
      if (fresh.ok) {
        setBrands(fresh.brands);
        setReloadMessage("Models reloaded.");
      } else {
        setReloadMessage(fresh.error ?? "The models could not be reloaded.");
      }
    } catch {
      setReloadMessage("The models could not be reloaded.");
    } finally {
      setReloading(false);
    }
  }

  // ---------- Totals (display only; the database calculates the saved values) ----------

  const phoneTotals = phones.map((row) => lineTotal(row.unitCost, row.imeis.length));
  const accessoryTotals = accessories.map((row) =>
    QUANTITY_PATTERN.test(row.quantity.trim())
      ? lineTotal(row.unitCost, Number(row.quantity.trim()))
      : null
  );
  const subtotal = [...phoneTotals, ...accessoryTotals].reduce<bigint>(
    (sum, value) => sum + (value ?? ZERO),
    ZERO
  );
  const extraValid = extraCost.trim() === "" || isValidMoneyInput(extraCost);
  const extraCents = extraValid ? toCents(extraCost.trim() || "0") ?? ZERO : ZERO;
  const total = subtotal + extraCents;
  const paidValid = paid.trim() === "" || isValidMoneyInput(paid);
  const paidCents = paidValid ? toCents(paid.trim() || "0") ?? ZERO : ZERO;
  const balance = total - paidCents;

  // ---------- Validation (reasons shown next to the Save button) ----------

  const reasons: string[] = [];
  if (!supplier) reasons.push("Choose a supplier.");
  if (!date) reasons.push("Choose the purchase date.");
  if (!extraValid) reasons.push("Extra cost must be a number with up to 2 decimals.");

  const filledPhones = phones.filter((row) => !isPhoneEmpty(row));
  phones.forEach((row, i) => {
    if (isPhoneEmpty(row)) return;
    const n = `Phone row ${i + 1}`;
    const specIssue = specProblem(row.spec);
    if (specIssue) reasons.push(`${n}: ${specIssue.charAt(0).toLowerCase()}${specIssue.slice(1)}`);
    if (row.imeis.length === 0) reasons.push(`${n}: add at least one IMEI.`);
    if (!isValidMoneyInput(row.unitCost)) reasons.push(`${n}: enter a valid purchase price.`);
    if (row.salePrice.trim() && !isValidMoneyInput(row.salePrice)) {
      reasons.push(`${n}: enter a valid sale price.`);
    }
    const stocked = row.imeis.filter((imei) => inStock.has(imei)).length;
    if (stocked > 0) {
      reasons.push(`${n}: ${stocked} IMEI ${stocked === 1 ? "is" : "are"} already in stock.`);
    }
  });

  const filledAccessories = accessories.filter((row) => !isAccessoryEmpty(row));
  accessories.forEach((row, i) => {
    if (isAccessoryEmpty(row)) return;
    const n = `Accessory row ${i + 1}`;
    if (!row.product) reasons.push(`${n}: choose a product.`);
    const qty = row.quantity.trim();
    if (!QUANTITY_PATTERN.test(qty) || Number(qty) < 1) {
      reasons.push(`${n}: quantity must be a whole number of 1 or more.`);
    }
    if (!isValidMoneyInput(row.unitCost)) reasons.push(`${n}: enter a valid purchase price.`);
    if (row.salePrice.trim() && !isValidMoneyInput(row.salePrice)) {
      reasons.push(`${n}: enter a valid sale price.`);
    }
  });

  if (filledPhones.length === 0 && filledAccessories.length === 0) {
    reasons.push("Add at least one phone or accessory.");
  }
  if (!paidValid) reasons.push("Paid now must be a number with up to 2 decimals.");
  if (paidValid && paidCents > ZERO && !method) {
    reasons.push("Choose Cash or Bank for the payment.");
  }
  if (paidValid && paidCents > total) reasons.push("Paid now cannot be more than the total.");

  const canSave = reasons.length === 0 && !saving;

  // ---------- Save ----------

  async function save() {
    if (!canSave || !supplier) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      supplier_id: supplier.id,
      purchase_date: date,
      supplier_invoice_no: invoiceNo.trim() || null,
      extra_cost: moneyNumber(extraCost.trim() || "0"),
      paid_amount: moneyNumber(paid.trim() || "0"),
      payment_method: paidCents > ZERO ? method : null,
      notes: notes.trim() || null,
      items: [
        ...filledPhones.map((row) => ({
          item_type: "phone",
          ...specPayload(row.spec),
          pta_status: row.pta || null,
          condition: row.condition,
          unit_cost: moneyNumber(row.unitCost),
          sale_price: row.salePrice.trim() ? moneyNumber(row.salePrice) : null,
          imeis: row.imeis,
        })),
        ...filledAccessories.map((row) => ({
          item_type: "accessory",
          product_id: row.product?.id,
          quantity: Number(row.quantity.trim()),
          unit_cost: moneyNumber(row.unitCost),
          sale_price: row.salePrice.trim() ? moneyNumber(row.salePrice) : null,
        })),
      ],
    };

    try {
      const response = await savePurchase(payload);
      if (response.ok && response.result) {
        setResult(response.result);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setSaveError(response.error ?? "The purchase could not be saved.");
      }
    } catch {
      setSaveError("The purchase could not be saved. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setSupplier(null);
    setDate(today);
    setInvoiceNo("");
    setExtraCost("");
    setNotes("");
    setMoreOpen(false);
    setPhones([emptyPhone()]);
    setAccessories([emptyAccessory()]);
    setInStock(new Set());
    setPaid("");
    setMethod("");
    setSaveError(null);
    setResult(null);
  }

  // ---------- Keyboard: Enter moves to the next cell, Ctrl+Enter saves ----------

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      void save();
      return;
    }
    if (event.defaultPrevented || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement;
    if (["TEXTAREA", "BUTTON", "A"].includes(target.tagName)) return;
    const cell = target.closest<HTMLElement>("[data-cell]");
    if (!cell || !rootRef.current) return;

    const group = cell.dataset.group as Group;
    const cells = Array.from(
      rootRef.current.querySelectorAll<HTMLElement>(`[data-cell][data-group="${group}"]`)
    );
    const next = cells[cells.indexOf(cell) + 1];
    event.preventDefault();

    if (next) {
      focusCell(next);
    } else if (group === "phones") {
      addPhoneRow();
    } else if (group === "accessories") {
      addAccessoryRow();
    } else {
      focusCell(rootRef.current.querySelector(cellSelector("phones", 0, "model")));
    }
  }

  // ---------- Confirmation ----------

  if (result) {
    const totalCents = toCents(result.total);
    const balanceCents = toCents(result.balance);
    const paidResult =
      totalCents !== null && balanceCents !== null ? totalCents - balanceCents : null;
    return (
      <section className={cardClass + " mx-auto max-w-xl text-center"}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint">
          <CheckCircle2 className="h-8 w-8 text-accent" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-ink">Purchase saved</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Purchase no. <span className="font-semibold text-ink">{result.purchase_no ?? "—"}</span>
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-3 text-left">
          {[
            ["Total", formatMoney(totalCents, currency), "bg-aqua"],
            ["Paid", formatMoney(paidResult, currency), "bg-mint"],
            ["Balance", formatMoney(balanceCents, currency), "bg-peach"],
          ].map(([label, value, tone]) => (
            <div key={label} className={"rounded-2xl px-3 py-3 " + tone}>
              <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
              <dd className="mt-1 text-sm font-bold text-ink sm:text-base">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" onClick={resetAll} className={primaryButtonClass} autoFocus>
            <Plus className="h-4 w-4" />
            New purchase
          </button>
          <Link href="/purchases" className={secondaryButtonClass}>
            View purchases
          </Link>
        </div>
      </section>
    );
  }

  // ---------- Entry screen ----------

  const ptaShown = showsPta(region);
  const phoneGrid =
    "grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] xl:items-start xl:gap-2";
  const accessoryGrid =
    "grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[minmax(0,2.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] xl:items-start xl:gap-2";
  const headerCell = "text-xs font-bold uppercase tracking-wide text-ink-muted";

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="space-y-6">
      {/* Header */}
      <section className={cardClass + " space-y-4"}>
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Cell label="Supplier" group="header" row={0} col="supplier" showLabel>
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
                autoFocus
                label="Supplier"
                placeholder="Search or add a supplier..."
                onSelect={(picked) => {
                  setSupplier(picked);
                  pendingFocus.current = cellSelector("phones", 0, "model");
                }}
              />
            )}
          </Cell>
          <Cell label="Date" group="header" row={0} col="date" showLabel>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={inputClass}
              aria-label="Purchase date"
            />
          </Cell>
          <Cell label="Supplier invoice no (optional)" group="header" row={0} col="invoice" showLabel>
            <input
              type="text"
              maxLength={60}
              autoComplete="off"
              value={invoiceNo}
              onChange={(event) => setInvoiceNo(event.target.value)}
              className={inputClass}
              aria-label="Supplier invoice number"
            />
          </Cell>
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
        >
          <ChevronDown className={"h-4 w-4 transition-transform " + (moreOpen ? "rotate-180" : "")} />
          More details
        </button>
        {moreOpen && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <label htmlFor="purchase-extra" className={labelClass}>
                Extra cost ({currency})
              </label>
              <input
                id="purchase-extra"
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={extraCost}
                onChange={(event) => setExtraCost(event.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-muted">Freight, transport and similar costs.</p>
            </div>
            <div>
              <label htmlFor="purchase-notes" className={labelClass}>
                Notes (optional)
              </label>
              <textarea
                id="purchase-notes"
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}
      </section>

      {/* Phones */}
      <section className={cardClass}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-accent" />
            <h2 className="text-base font-bold text-ink">Phones</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reloadMessage && <span className="text-xs text-ink-muted">{reloadMessage}</span>}
            {canAddModels && (
              <button
                type="button"
                onClick={reloadModels}
                disabled={reloading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink hover:bg-surface-muted disabled:opacity-60"
              >
                <RefreshCw className={"h-3.5 w-3.5 " + (reloading ? "animate-spin" : "")} />
                Reload models
              </button>
            )}
          </div>
        </div>

        {quickAdd && (
          <div className="mb-3">
            <QuickAddModelForm
              key={`${quickAdd.row}-${quickAdd.query}`}
              query={quickAdd.query}
              brandNames={phoneIndex.brandNames}
              onCancel={() => setQuickAdd(null)}
              onAdded={async (added) => {
                await reloadModels();
                updateSpec(quickAdd.row, { modelId: added.modelId, storage: added.storage, ram: added.ram });
                setQuickAdd(null);
              }}
            />
          </div>
        )}

        <div className={"hidden border-b border-line pb-2 xl:grid " + phoneGrid}>
          <span className={headerCell}>Model</span>
          <span className={headerCell}>Storage / RAM</span>
          <span className={headerCell}>Colour</span>
          <span className={headerCell}>{ptaShown ? "Condition / PTA" : "Condition"}</span>
          <span className={headerCell}>Purchase price</span>
          <span className={headerCell}>Sale price</span>
          <span className={headerCell + " text-right"}>Total</span>
          <span className="w-[6.25rem]" />
        </div>

        <div className="space-y-3 xl:space-y-0">
          {phones.map((row, index) => {
            const entry = phoneIndex.models.get(row.spec.modelId);
            const model = entry?.model;
            const rowTotal = phoneTotals[index];
            return (
              <div
                key={row.key}
                className="rounded-2xl border border-line bg-surface p-4 xl:rounded-none xl:border-0 xl:border-b xl:px-0 xl:py-3"
              >
                <div className="mb-3 flex items-center justify-between xl:hidden">
                  <span className="text-sm font-bold text-ink">Phone {index + 1}</span>
                  <RowActions
                    label={`phone row ${index + 1}`}
                    onCopy={() => copyPhoneRow(index)}
                    onRemove={() => removePhoneRow(index)}
                  />
                </div>
                <div className={phoneGrid}>
                  <Cell label="Model" group="phones" row={index} col="model" className="col-span-2 md:col-span-2 xl:col-span-1">
                    <PhoneModelSearch
                      index={phoneIndex}
                      value={row.spec.modelId}
                      selectedLabel={entry?.label ?? ""}
                      onPick={(option) =>
                        updateSpec(index, {
                          modelId: option.modelId,
                          storage: option.storage ? String(option.storage) : "",
                          ram: option.ram ? String(option.ram) : "",
                        })
                      }
                      onClear={() => updateSpec(index, EMPTY_SPEC)}
                      onQuickAdd={(query) => setQuickAdd({ row: index, query })}
                      onReload={() => void reloadModels()}
                      reloading={reloading}
                      label={`Model, phone row ${index + 1}`}
                    />
                  </Cell>
                  <Cell label="Storage" group="phones" row={index} col="storage">
                    <div className="space-y-1.5">
                      <StoragePicker
                        key={`${row.key}-${row.spec.modelId}-storage`}
                        model={model}
                        value={row.spec.storage}
                        onChange={(storage) => updateSpec(index, { storage })}
                        label={`Storage, phone row ${index + 1}`}
                      />
                      {!isApple(entry?.brand) && (
                        <RamPicker
                          key={`${row.key}-${row.spec.modelId}-ram`}
                          model={model}
                          storage={row.spec.storage}
                          value={row.spec.ram}
                          onChange={(ram) => updateSpec(index, { ram })}
                          label={`RAM, phone row ${index + 1}`}
                        />
                      )}
                    </div>
                  </Cell>
                  <Cell label="Colour" group="phones" row={index} col="color">
                    <ColorPicker
                      model={model}
                      value={row.spec.color}
                      onChange={(color) => updateSpec(index, { color })}
                      label={`Colour, phone row ${index + 1}`}
                    />
                  </Cell>
                  <Cell label="Condition" group="phones" row={index} col="condition">
                    <div className="space-y-1.5">
                    <select
                      value={row.condition}
                      onChange={(event) =>
                        updatePhone(index, { condition: event.target.value as Condition })
                      }
                      aria-label={`Condition, phone row ${index + 1}`}
                      className={inputClass}
                    >
                      {CONDITIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {ptaShown && (
                      <PtaSelect
                        value={row.pta}
                        onChange={(pta) => updatePhone(index, { pta })}
                        label={`PTA status, phone row ${index + 1}`}
                      />
                    )}
                    </div>
                  </Cell>
                  <Cell
                    label="IMEI numbers"
                    group="phones"
                    row={index}
                    col="imei"
                    className="col-span-2 md:col-span-4 xl:order-last xl:col-span-8"
                  >
                    <ImeiInput
                      imeis={row.imeis}
                      inStock={inStock}
                      onAdd={(values) => addImeis(index, values)}
                      onRemove={(imei) => removeImei(index, imei)}
                      label={`IMEI numbers, phone row ${index + 1}`}
                    />
                  </Cell>
                  <Cell label={`Purchase price (${currency})`} group="phones" row={index} col="cost">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={row.unitCost}
                      onChange={(event) => updatePhone(index, { unitCost: event.target.value })}
                      aria-label={`Purchase price per unit, phone row ${index + 1}`}
                      className={inputClass}
                    />
                  </Cell>
                  <Cell label={`Sale price (${currency})`} group="phones" row={index} col="sale">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="Optional"
                      value={row.salePrice}
                      onChange={(event) => updatePhone(index, { salePrice: event.target.value })}
                      aria-label={`Sale price, phone row ${index + 1}`}
                      className={inputClass}
                    />
                  </Cell>
                  <div className="flex flex-col justify-center xl:min-h-11 xl:items-end">
                    <span className="mb-1.5 block text-xs font-semibold text-ink-muted xl:sr-only">Total</span>
                    <span className="text-sm font-bold text-ink">
                      {rowTotal === null ? "—" : formatMoney(rowTotal, currency)}
                    </span>
                  </div>
                  <div className="hidden xl:block">
                    <RowActions
                      label={`phone row ${index + 1}`}
                      onCopy={() => copyPhoneRow(index)}
                      onRemove={() => removePhoneRow(index)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addPhoneRow}
          className={secondaryButtonClass + " mt-4 w-full sm:w-auto"}
        >
          <Plus className="h-4 w-4" />
          Add phone row
        </button>
      </section>

      {/* Accessories */}
      <section className={cardClass}>
        <div className="mb-4 flex items-center gap-2">
          <Headphones className="h-5 w-5 text-accent" />
          <h2 className="text-base font-bold text-ink">Accessories</h2>
        </div>

        <div className={"hidden border-b border-line pb-2 xl:grid " + accessoryGrid}>
          <span className={headerCell}>Product</span>
          <span className={headerCell}>Quantity</span>
          <span className={headerCell}>Purchase price</span>
          <span className={headerCell}>Sale price</span>
          <span className={headerCell + " text-right"}>Total</span>
          <span className="w-[6.25rem]" />
        </div>

        <div className="space-y-3 xl:space-y-0">
          {accessories.map((row, index) => {
            const rowTotal = accessoryTotals[index];
            return (
              <div
                key={row.key}
                className="rounded-2xl border border-line bg-surface p-4 xl:rounded-none xl:border-0 xl:border-b xl:px-0 xl:py-3"
              >
                <div className="mb-3 flex items-center justify-between xl:hidden">
                  <span className="text-sm font-bold text-ink">Accessory {index + 1}</span>
                  <RowActions
                    label={`accessory row ${index + 1}`}
                    onCopy={() => copyAccessoryRow(index)}
                    onRemove={() => removeAccessoryRow(index)}
                  />
                </div>
                <div className={accessoryGrid}>
                  <Cell label="Product" group="accessories" row={index} col="product" className="col-span-2 md:col-span-4 xl:col-span-1">
                    {row.product ? (
                      <div className="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-line-strong bg-surface-muted px-4">
                        <span className="min-w-0 truncate text-sm font-semibold text-ink">
                          {row.product.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            pendingFocus.current = cellSelector("accessories", index, "product");
                            updateAccessory(index, { product: null });
                          }}
                          aria-label={`Change product, accessory row ${index + 1}`}
                          className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent"
                        >
                          <X className="h-3.5 w-3.5" />
                          Change
                        </button>
                      </div>
                    ) : (
                      <ProductPicker
                        canCreate={canCreateProducts}
                        label={`Product, accessory row ${index + 1}`}
                        placeholder="Search or add a product..."
                        onSelect={(product) => void selectProduct(index, product)}
                      />
                    )}
                  </Cell>
                  <Cell label="Quantity" group="accessories" row={index} col="quantity">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={row.quantity}
                      onChange={(event) => updateAccessory(index, { quantity: event.target.value })}
                      aria-label={`Quantity, accessory row ${index + 1}`}
                      className={inputClass}
                    />
                  </Cell>
                  <Cell label={`Purchase price (${currency})`} group="accessories" row={index} col="cost">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={row.unitCost}
                      onChange={(event) => updateAccessory(index, { unitCost: event.target.value })}
                      aria-label={`Purchase price per unit, accessory row ${index + 1}`}
                      className={inputClass}
                    />
                  </Cell>
                  <Cell label={`Sale price (${currency})`} group="accessories" row={index} col="sale">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="Optional"
                      value={row.salePrice}
                      onChange={(event) => updateAccessory(index, { salePrice: event.target.value })}
                      aria-label={`Sale price, accessory row ${index + 1}`}
                      className={inputClass}
                    />
                  </Cell>
                  <div className="flex flex-col justify-center xl:min-h-11 xl:items-end">
                    <span className="mb-1.5 block text-xs font-semibold text-ink-muted xl:sr-only">Total</span>
                    <span className="text-sm font-bold text-ink">
                      {rowTotal === null ? "—" : formatMoney(rowTotal, currency)}
                    </span>
                  </div>
                  <div className="hidden xl:block">
                    <RowActions
                      label={`accessory row ${index + 1}`}
                      onCopy={() => copyAccessoryRow(index)}
                      onRemove={() => removeAccessoryRow(index)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addAccessoryRow}
          className={secondaryButtonClass + " mt-4 w-full sm:w-auto"}
        >
          <Plus className="h-4 w-4" />
          Add accessory row
        </button>
      </section>

      {/* Footer: totals, payment and save */}
      <section className="z-30 rounded-card border border-line bg-surface p-4 shadow-soft md:sticky md:bottom-24 lg:bottom-3 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] lg:items-start">
          <dl className="grid grid-cols-3 gap-2 text-sm lg:grid-cols-1 lg:gap-1">
            <div className="flex flex-col lg:flex-row lg:justify-between">
              <dt className="text-xs text-ink-muted lg:text-sm">Subtotal</dt>
              <dd className="font-semibold text-ink">{formatMoney(subtotal, currency)}</dd>
            </div>
            <div className="flex flex-col lg:flex-row lg:justify-between">
              <dt className="text-xs text-ink-muted lg:text-sm">Extra cost</dt>
              <dd className="font-semibold text-ink">{formatMoney(extraCents, currency)}</dd>
            </div>
            <div className="flex flex-col lg:flex-row lg:justify-between">
              <dt className="text-xs text-ink-muted lg:text-sm">Total</dt>
              <dd className="text-base font-bold text-ink">{formatMoney(total, currency)}</dd>
            </div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="purchase-paid" className={labelClass}>
                Paid now ({currency})
              </label>
              <input
                id="purchase-paid"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={paid}
                onChange={(event) => setPaid(event.target.value)}
                className={inputClass}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaid(centsToPlain(total))}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-mint px-3 text-xs font-semibold text-ink"
                >
                  Pay full amount
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaid("");
                    setMethod("");
                  }}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-line-strong px-3 text-xs font-semibold text-ink"
                >
                  Nothing now
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="purchase-method" className={labelClass}>
                Payment method
              </label>
              <select
                id="purchase-method"
                value={method}
                onChange={(event) => setMethod(event.target.value as "" | "cash" | "bank")}
                disabled={paidCents <= ZERO}
                className={inputClass + " disabled:opacity-60"}
              >
                <option value="">{paidCents > ZERO ? "Choose" : "Not needed"}</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
              <div className="mt-2 flex min-h-11 items-center justify-between rounded-2xl bg-peach px-4">
                <span className="text-xs font-semibold text-ink-muted">Balance</span>
                <span className="text-sm font-bold text-ink">{formatMoney(balance, currency)}</span>
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
              {saving ? "Saving..." : "Save purchase"}
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
