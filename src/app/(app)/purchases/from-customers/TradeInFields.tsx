"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inputClass, labelClass } from "@/components/ui";
import PhoneSpecFields from "@/components/phone/PhoneSpecFields";
import { checkImeisInStock, type CatalogBrand } from "@/app/(app)/purchases/new/actions";
import { buildPhoneIndex } from "@/lib/phone-catalog";
import { showsPta } from "@/lib/pta";
import { idNumberLabel, phonePlaceholder, regionOf } from "@/lib/region";
import { GRADE_OPTIONS, cleanImei, type TradeInDraft, type TradeInGrade } from "@/lib/trade-in";

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
  region = "PK",
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
  // "PK" (Pakistan) or "AE" (UAE): decides PTA, phone and ID formats
  region?: string;
  priceLabel: string;
  // Tells the parent whether an IMEI is already in stock (saving is blocked)
  onImeiChecked: (imei: string, inStock: boolean) => void;
}) {
  const index = useMemo(() => buildPhoneIndex(brands), [brands]);
  const [checked, setChecked] = useState<{ imei: string; inStock: boolean } | null>(null);
  const stockRequest = useRef(0);
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
            placeholder={phonePlaceholder(regionOf({ region }))}
            value={value.sellerPhone}
            onChange={(e) => onChange({ sellerPhone: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={id("seller-id")} className={labelClass}>
            {idNumberLabel(regionOf({ region }))} (optional)
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

      {/* Phone: model (type-ahead), storage, RAM, colour, PTA */}
      <PhoneSpecFields
        idPrefix={id("phone")}
        index={index}
        loading={loadingCatalog}
        onReloadCatalog={onReloadCatalog}
        spec={value.spec}
        onChange={(patch) => onChange({ spec: { ...value.spec, ...patch } })}
        pta={value.pta}
        onPtaChange={(pta) => onChange({ pta })}
        showPta={showsPta(region)}
        canQuickAdd
      />

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
            placeholder="0"
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
