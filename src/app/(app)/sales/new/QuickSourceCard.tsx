"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Headphones, Loader2, PackagePlus, Smartphone, X } from "lucide-react";
import ProductPicker, { type PickedProduct } from "@/components/ProductPicker";
import { inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { centsToPlain, isValidMoneyInput, toCents } from "@/lib/money";
import ModelCombobox, { type ModelOption } from "@/app/(app)/purchases/new/ModelCombobox";
import ImeiInput from "@/app/(app)/purchases/new/ImeiInput";
import {
  checkImeisInStock,
  getProductSalePrice,
  type CatalogBrand,
  type CatalogModel,
} from "@/app/(app)/purchases/new/actions";

type Condition = "new" | "used" | "open_box" | "refurbished";

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: "new", label: "New" },
  { value: "used", label: "Used" },
  { value: "open_box", label: "Open box" },
  { value: "refurbished", label: "Refurbished" },
];

const IMEI_PATTERN = /^\d{15}$/;
const WHOLE = /^\d+$/;

// What the card hands back to the sale grid
export type SourcedDraft =
  | {
      kind: "phone";
      modelId: string;
      variantId: string;
      colorId: string | null;
      condition: Condition;
      imei: string;
      title: string;
      detail: string;
      cost: string;
      salePrice: string;
    }
  | {
      kind: "accessory";
      productId: string;
      title: string;
      quantity: string;
      cost: string;
      salePrice: string;
    };

function storageLabel(gb: number) {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

function variantLabel(v: { storage_gb: number; ram_gb: number | null }) {
  return v.ram_gb ? `${storageLabel(v.storage_gb)} / ${v.ram_gb} GB RAM` : storageLabel(v.storage_gb);
}

function focusField(element: Element | null) {
  if (!element) return;
  const target = element.matches("input, select, button")
    ? element
    : element.querySelector("input, select, button");
  (target as HTMLElement | null)?.focus();
}

// Inline card (a bottom sheet on phones) to sell an item that is not in
// stock yet. It is bought from a supplier in the same save.
export default function QuickSourceCard({
  brands,
  loadingCatalog,
  onReloadCatalog,
  canAddModels,
  canCreateProducts,
  currency,
  usedImeis,
  onAdd,
  onClose,
}: {
  brands: CatalogBrand[] | null;
  loadingCatalog: boolean;
  onReloadCatalog: () => void;
  canAddModels: boolean;
  canCreateProducts: boolean;
  currency: string;
  usedImeis: Set<string>;
  onAdd: (draft: SourcedDraft) => void;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const stockRequest = useRef(0);
  const [mode, setMode] = useState<"phone" | "accessory">("phone");

  // Phone fields
  const [modelId, setModelId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [colorId, setColorId] = useState("");
  const [condition, setCondition] = useState<Condition>("new");
  const [imeis, setImeis] = useState<string[]>([]);
  const [inStock, setInStock] = useState<Set<string>>(() => new Set());
  const [checking, setChecking] = useState(false);

  // Accessory fields
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [quantity, setQuantity] = useState("1");

  // Shared fields
  const [cost, setCost] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const { modelOptions, modelMap } = useMemo(() => {
    const options: ModelOption[] = [];
    const map = new Map<string, { model: CatalogModel; label: string }>();
    for (const brand of brands ?? []) {
      for (const model of brand.models) {
        const label = `${brand.name} ${model.name}`;
        options.push({ id: model.id, label });
        map.set(model.id, { model, label });
      }
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    return { modelOptions: options, modelMap: map };
  }, [brands]);

  const selected = modelMap.get(modelId);
  const model = selected?.model;

  // Focus the first field when the card opens or the mode changes
  useEffect(() => {
    focusField(cardRef.current?.querySelector("[data-src-field]") ?? null);
  }, [mode]);

  function chooseModel(id: string) {
    const next = modelMap.get(id)?.model;
    setModelId(id);
    setVariantId(next && next.variants.length === 1 ? next.variants[0].id : "");
    setColorId(next && next.colors.length === 1 ? next.colors[0].id : "");
  }

  // One IMEI per line; the stock check runs right away
  function addImei(values: string[]): string | null {
    if (imeis.length > 0 || values.length > 1) {
      return "Only one IMEI per line. Add another line for the next phone.";
    }
    const imei = values[0];
    if (!IMEI_PATTERN.test(imei)) return `${imei} must be exactly 15 digits.`;
    if (usedImeis.has(imei)) return "This IMEI is already on this invoice.";
    setImeis([imei]);
    const id = ++stockRequest.current;
    setChecking(true);
    checkImeisInStock([imei])
      .then((found) => {
        if (id === stockRequest.current) setInStock(new Set(found));
      })
      .catch(() => {
        // The database checks again when saving
      })
      .finally(() => {
        if (id === stockRequest.current) setChecking(false);
      });
    return null;
  }

  function removeImei() {
    stockRequest.current += 1;
    setImeis([]);
    setInStock(new Set());
    setChecking(false);
  }

  async function chooseProduct(picked: PickedProduct) {
    setProduct(picked);
    requestAnimationFrame(() =>
      focusField(cardRef.current?.querySelector('[data-src-field="quantity"]') ?? null)
    );
    try {
      const price = await getProductSalePrice(picked.id);
      const cents = toCents(price);
      if (cents !== null) setSalePrice((current) => (current.trim() ? current : centsToPlain(cents)));
    } catch {
      // No saved sale price; the field stays empty
    }
  }

  // ---------- Validation ----------

  const reasons: string[] = [];
  if (mode === "phone") {
    if (!modelId) reasons.push("Choose a model.");
    else if (!variantId) reasons.push("Choose the storage.");
    if (imeis.length === 0) reasons.push("Add the IMEI.");
    else if (inStock.has(imeis[0])) {
      reasons.push("This IMEI is already in stock. Pick it from the Add item list instead.");
    } else if (checking) reasons.push("Checking the IMEI...");
  } else {
    if (!product) reasons.push("Choose a product.");
    if (!WHOLE.test(quantity.trim()) || Number(quantity.trim()) < 1) {
      reasons.push("Quantity must be a whole number of 1 or more.");
    }
  }
  if (!isValidMoneyInput(cost)) reasons.push("Enter a valid purchase price.");
  if (!isValidMoneyInput(salePrice)) reasons.push("Enter a valid sale price.");
  const canAdd = reasons.length === 0;

  function add() {
    if (!canAdd) return;
    if (mode === "phone" && model && selected) {
      const variant = model.variants.find((v) => v.id === variantId);
      const color = model.colors.find((c) => c.id === colorId);
      const conditionLabel = CONDITIONS.find((c) => c.value === condition)?.label ?? condition;
      onAdd({
        kind: "phone",
        modelId,
        variantId,
        colorId: colorId || null,
        condition,
        imei: imeis[0],
        title: selected.label,
        detail: [variant ? variantLabel(variant) : null, color?.name, conditionLabel]
          .filter(Boolean)
          .join(" · "),
        cost,
        salePrice,
      });
    } else if (mode === "accessory" && product) {
      onAdd({
        kind: "accessory",
        productId: product.id,
        title: product.name,
        quantity: quantity.trim(),
        cost,
        salePrice,
      });
    }
  }

  // Enter moves to the next field; on the last field it adds the line
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // A dropdown inside the card closes first
      if (event.defaultPrevented) return;
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey) return;
    if (event.defaultPrevented || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.tagName === "A") return;
    const field = target.closest<HTMLElement>("[data-src-field]");
    if (!field || !cardRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const fields = Array.from(cardRef.current.querySelectorAll<HTMLElement>("[data-src-field]"));
    const next = fields[fields.indexOf(field) + 1];
    if (next) focusField(next);
    else add();
  }

  const modeButton = (value: "phone" | "accessory", label: string, Icon: typeof Smartphone) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-colors " +
        (mode === value ? "bg-pill text-pill-ink shadow-soft" : "text-ink-muted hover:text-ink")
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <>
      {/* Phones: dim the page behind the bottom sheet */}
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden="true" />

      <div
        ref={cardRef}
        role="dialog"
        aria-label="Add an item that is not in stock"
        onKeyDown={onKeyDown}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-card border border-line bg-surface p-4 shadow-soft md:static md:z-auto md:max-h-none md:rounded-card md:border-2 md:border-dashed md:border-accent/40 md:p-5"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pill text-pill-ink">
              <PackagePlus className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-ink">Not in stock: buy from a supplier</h3>
              <p className="text-xs text-ink-muted">
                The purchase is saved together with this sale.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="Item type"
              className="inline-flex rounded-full border border-line bg-surface-muted p-1"
            >
              {modeButton("phone", "Phone", Smartphone)}
              {modeButton("accessory", "Accessory", Headphones)}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {mode === "phone" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div data-src-field="model" className="sm:col-span-2">
              <span className={labelClass}>Model</span>
              {loadingCatalog && !brands ? (
                <p className="flex min-h-11 items-center gap-2 text-sm text-ink-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading models...
                </p>
              ) : (
                <ModelCombobox
                  models={modelOptions}
                  value={modelId}
                  onChange={chooseModel}
                  canAddModels={canAddModels}
                  onReload={onReloadCatalog}
                  reloading={loadingCatalog}
                  label="Model"
                />
              )}
            </div>
            <div data-src-field="storage">
              <label htmlFor="src-storage" className={labelClass}>
                Storage
              </label>
              <select
                id="src-storage"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                disabled={!model}
                className={inputClass + " disabled:opacity-60"}
              >
                <option value="">{model ? "Choose" : "Pick a model"}</option>
                {model?.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v)}
                  </option>
                ))}
              </select>
            </div>
            <div data-src-field="color">
              <label htmlFor="src-color" className={labelClass}>
                Colour
              </label>
              <select
                id="src-color"
                value={colorId}
                onChange={(e) => setColorId(e.target.value)}
                disabled={!model}
                className={inputClass + " disabled:opacity-60"}
              >
                <option value="">{model && model.colors.length === 0 ? "No colours" : "Optional"}</option>
                {model?.colors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div data-src-field="condition">
              <label htmlFor="src-condition" className={labelClass}>
                Condition
              </label>
              <select
                id="src-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as Condition)}
                className={inputClass}
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div data-src-field="imei" className="sm:col-span-2 lg:col-span-3">
              <span className={labelClass}>IMEI</span>
              <ImeiInput
                imeis={imeis}
                inStock={inStock}
                onAdd={addImei}
                onRemove={removeImei}
                label="IMEI"
              />
            </div>
            <div data-src-field="cost">
              <label htmlFor="src-cost" className={labelClass}>
                Purchase price ({currency})
              </label>
              <input
                id="src-cost"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="What you pay the supplier"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className={inputClass}
              />
            </div>
            <div data-src-field="sale">
              <label htmlFor="src-sale" className={labelClass}>
                Sale price ({currency})
              </label>
              <input
                id="src-sale"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div data-src-field="product" className="sm:col-span-2">
              <span className={labelClass}>Product</span>
              {product ? (
                <div className="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-line-strong bg-surface-muted px-4">
                  <span className="min-w-0 truncate text-sm font-semibold text-ink">{product.name}</span>
                  <button
                    type="button"
                    onClick={() => setProduct(null)}
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent"
                  >
                    <X className="h-3.5 w-3.5" />
                    Change
                  </button>
                </div>
              ) : (
                <ProductPicker
                  canCreate={canCreateProducts}
                  label="Product"
                  placeholder="Search or add a product..."
                  onSelect={(picked) => void chooseProduct(picked)}
                />
              )}
            </div>
            <div data-src-field="quantity">
              <label htmlFor="src-qty" className={labelClass}>
                Quantity
              </label>
              <input
                id="src-qty"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={inputClass}
              />
            </div>
            <div data-src-field="cost">
              <label htmlFor="src-acc-cost" className={labelClass}>
                Purchase price ({currency})
              </label>
              <input
                id="src-acc-cost"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Per unit"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className={inputClass}
              />
            </div>
            <div data-src-field="sale">
              <label htmlFor="src-acc-sale" className={labelClass}>
                Sale price ({currency})
              </label>
              <input
                id="src-acc-sale"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className={primaryButtonClass + " w-full sm:w-auto"}
          >
            <PackagePlus className="h-4 w-4" />
            Add to sale
          </button>
          {reasons.length > 0 && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              {reasons[0]}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
