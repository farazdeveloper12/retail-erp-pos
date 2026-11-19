"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Notice, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import ModelCombobox, { type ModelOption } from "@/app/(app)/purchases/new/ModelCombobox";
import {
  checkImeisInStock,
  type CatalogBrand,
  type CatalogModel,
} from "@/app/(app)/purchases/new/actions";
import { quickAddPhoneModel } from "@/app/(app)/purchases/from-customers/actions";
import { GRADE_OPTIONS, cleanImei, type TradeInDraft, type TradeInGrade } from "@/lib/trade-in";

const STORAGE_OPTIONS = [32, 64, 128, 256, 512, 1024];

function storageLabel(gb: number) {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

function variantLabel(v: { storage_gb: number; ram_gb: number | null }) {
  return v.ram_gb ? `${storageLabel(v.storage_gb)} / ${v.ram_gb} GB RAM` : storageLabel(v.storage_gb);
}

// Seller, phone and price fields of a phone bought from a customer. Used by
// "Buy from customer" and by the POS trade-in card.
export default function TradeInFields({
  idPrefix,
  value,
  onChange,
  brands,
  loadingCatalog,
  onReloadCatalog,
  currency,
  priceLabel,
  onImeiChecked,
}: {
  idPrefix: string;
  value: TradeInDraft;
  onChange: (patch: Partial<TradeInDraft>) => void;
  brands: CatalogBrand[] | null;
  loadingCatalog: boolean;
  onReloadCatalog: () => Promise<void>;
  currency: string;
  priceLabel: string;
  // Tells the parent whether an IMEI is already in stock (saving is blocked)
  onImeiChecked: (imei: string, inStock: boolean) => void;
}) {
  const [quickAdd, setQuickAdd] = useState<{ brand: string; model: string; storage: string; ram: string } | null>(
    null
  );
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [checked, setChecked] = useState<{ imei: string; inStock: boolean } | null>(null);
  const stockRequest = useRef(0);

  const { modelOptions, modelMap, brandNames } = useMemo(() => {
    const options: ModelOption[] = [];
    const map = new Map<string, { model: CatalogModel; label: string }>();
    const names: string[] = [];
    for (const brand of brands ?? []) {
      names.push(brand.name);
      for (const model of brand.models) {
        const label = `${brand.name} ${model.name}`;
        options.push({ id: model.id, label });
        map.set(model.id, { model, label });
      }
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    return { modelOptions: options, modelMap: map, brandNames: names };
  }, [brands]);

  const model = modelMap.get(value.modelId)?.model;
  const imei = cleanImei(value.imei);

  const imeiComplete = /^\d{15}$/.test(imei);

  // Stock check as soon as the IMEI has 15 digits; the database checks again
  useEffect(() => {
    const id = ++stockRequest.current;
    if (!imeiComplete) return;
    checkImeisInStock([imei])
      .then((found) => {
        if (id !== stockRequest.current) return;
        const inStock = found.includes(imei);
        setChecked({ imei, inStock });
        onImeiChecked(imei, inStock);
      })
      .catch(() => {
        // The database checks again when saving
      });
  }, [imei, imeiComplete, onImeiChecked]);

  const imeiState = !imeiComplete
    ? "idle"
    : checked?.imei !== imei
      ? "checking"
      : checked.inStock
        ? "in_stock"
        : "free";

  function chooseModel(id: string) {
    const next = modelMap.get(id)?.model;
    onChange({
      modelId: id,
      variantId: next && next.variants.length === 1 ? next.variants[0].id : "",
      colorId: "",
    });
  }

  // The typed text may start with a known brand: "Samsung Galaxy A06"
  function startQuickAdd(query: string) {
    const brand = brandNames.find((b) => query.toLowerCase().startsWith(b.toLowerCase() + " "));
    setQuickError(null);
    setQuickAdd({
      brand: brand ?? "",
      model: brand ? query.slice(brand.length).trim() : query,
      storage: "128",
      ram: "",
    });
  }

  async function saveQuickAdd() {
    if (!quickAdd) return;
    setQuickSaving(true);
    setQuickError(null);
    try {
      const result = await quickAddPhoneModel({
        brand: quickAdd.brand,
        model: quickAdd.model,
        storage_gb: Number(quickAdd.storage),
        ram_gb: quickAdd.ram.trim() ? Number(quickAdd.ram) : null,
      });
      if (!result.ok || !result.modelId || !result.variantId) {
        setQuickError(result.error ?? "The model could not be added.");
        return;
      }
      await onReloadCatalog();
      onChange({ modelId: result.modelId, variantId: result.variantId, colorId: "" });
      setQuickAdd(null);
    } catch {
      setQuickError("The model could not be added. Please check your connection.");
    } finally {
      setQuickSaving(false);
    }
  }

  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="space-y-4">
      {/* Seller */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={id("seller-name")} className={labelClass}>
            Seller name
          </label>
          <input
            id={id("seller-name")}
            type="text"
            autoComplete="off"
            maxLength={120}
            value={value.sellerName}
            onChange={(e) => onChange({ sellerName: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={id("seller-phone")} className={labelClass}>
            Seller phone
          </label>
          <input
            id={id("seller-phone")}
            type="tel"
            autoComplete="off"
            maxLength={40}
            value={value.sellerPhone}
            onChange={(e) => onChange({ sellerPhone: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={id("seller-id")} className={labelClass}>
            CNIC / Emirates ID (optional)
          </label>
          <input
            id={id("seller-id")}
            type="text"
            autoComplete="off"
            maxLength={40}
            value={value.sellerIdNumber}
            onChange={(e) => onChange({ sellerIdNumber: e.target.value })}
            className={inputClass + " font-mono"}
          />
        </div>
      </div>

      {/* Phone */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <span className={labelClass}>Phone model</span>
          {loadingCatalog && !brands ? (
            <p className="flex min-h-11 items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading models...
            </p>
          ) : (
            <ModelCombobox
              models={modelOptions}
              value={value.modelId}
              onChange={chooseModel}
              canAddModels={false}
              onReload={() => void onReloadCatalog()}
              reloading={loadingCatalog}
              label="Phone model"
              onQuickAdd={startQuickAdd}
            />
          )}
        </div>
        <div>
          <label htmlFor={id("storage")} className={labelClass}>
            Storage
          </label>
          <select
            id={id("storage")}
            value={value.variantId}
            onChange={(e) => onChange({ variantId: e.target.value })}
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
        <div>
          <label htmlFor={id("color")} className={labelClass}>
            Colour
          </label>
          <select
            id={id("color")}
            value={value.colorId}
            onChange={(e) => onChange({ colorId: e.target.value })}
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
      </div>

      {/* Add a missing model right here */}
      {quickAdd && (
        <div className="space-y-3 rounded-2xl border-2 border-dashed border-accent/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink">Add a new phone model</p>
            <button
              type="button"
              onClick={() => setQuickAdd(null)}
              aria-label="Close"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor={id("qa-brand")} className={labelClass}>
                Brand
              </label>
              <input
                id={id("qa-brand")}
                list={id("qa-brands")}
                type="text"
                maxLength={60}
                value={quickAdd.brand}
                onChange={(e) => setQuickAdd({ ...quickAdd, brand: e.target.value })}
                className={inputClass}
              />
              <datalist id={id("qa-brands")}>
                {brandNames.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor={id("qa-model")} className={labelClass}>
                Model name
              </label>
              <input
                id={id("qa-model")}
                type="text"
                maxLength={100}
                value={quickAdd.model}
                onChange={(e) => setQuickAdd({ ...quickAdd, model: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={id("qa-storage")} className={labelClass}>
                Storage
              </label>
              <select
                id={id("qa-storage")}
                value={quickAdd.storage}
                onChange={(e) => setQuickAdd({ ...quickAdd, storage: e.target.value })}
                className={inputClass}
              >
                {STORAGE_OPTIONS.map((gb) => (
                  <option key={gb} value={gb}>
                    {storageLabel(gb)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={id("qa-ram")} className={labelClass}>
                RAM in GB (optional)
              </label>
              <input
                id={id("qa-ram")}
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={quickAdd.ram}
                onChange={(e) => setQuickAdd({ ...quickAdd, ram: e.target.value.replace(/\D/g, "") })}
                className={inputClass}
              />
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            The phone catalog is shared. If this model already exists, it is chosen instead of added twice.
          </p>
          {quickError && <Notice kind="error">{quickError}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveQuickAdd()}
              disabled={quickSaving || !quickAdd.brand.trim() || !quickAdd.model.trim()}
              className={primaryButtonClass}
            >
              <Plus className="h-4 w-4" />
              {quickSaving ? "Adding..." : "Add and choose"}
            </button>
            <button type="button" onClick={() => setQuickAdd(null)} className={secondaryButtonClass}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor={id("imei")} className={labelClass}>
            IMEI
          </label>
          <input
            id={id("imei")}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            placeholder="15 digits (dial *#06#)"
            value={value.imei}
            onChange={(e) => onChange({ imei: e.target.value.replace(/[^\d\s]/g, "") })}
            aria-describedby={id("imei-state")}
            className={inputClass + " font-mono"}
          />
          <p id={id("imei-state")} className="mt-1 text-xs" aria-live="polite">
            {imeiState === "checking" && <span className="text-ink-muted">Checking stock...</span>}
            {imeiState === "in_stock" && (
              <span className="font-semibold text-danger">This IMEI is already in stock. It cannot be bought again.</span>
            )}
            {imeiState === "free" && <span className="text-ink-muted">Not in stock: OK.</span>}
          </p>
        </div>
        <div>
          <label htmlFor={id("grade")} className={labelClass}>
            Condition
          </label>
          <select
            id={id("grade")}
            value={value.grade}
            onChange={(e) => onChange({ grade: e.target.value as TradeInGrade | "" })}
            className={inputClass}
          >
            <option value="">Choose grade</option>
            {GRADE_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id("price")} className={labelClass}>
            {priceLabel} ({currency})
          </label>
          <input
            id={id("price")}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value.price}
            onChange={(e) => onChange({ price: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label htmlFor={id("notes")} className={labelClass}>
            Condition notes (optional)
          </label>
          <input
            id={id("notes")}
            type="text"
            autoComplete="off"
            maxLength={500}
            placeholder="For example: small scratch on the back, battery 86%"
            value={value.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={id("sale-price")} className={labelClass}>
            Sale price later ({currency}, optional)
          </label>
          <input
            id={id("sale-price")}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value.salePrice}
            onChange={(e) => onChange({ salePrice: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
