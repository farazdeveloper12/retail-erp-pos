"use client";

import { Headphones, Smartphone, Truck, X } from "lucide-react";
import SupplierPicker, { type PickedSupplier } from "@/components/SupplierPicker";
import { inputClass } from "@/components/ui";
import PhoneModelSearch from "@/components/phone/PhoneModelSearch";
import { ColorPicker, PtaSelect, RamPicker, StoragePicker } from "@/components/phone/PhoneOptionPickers";
import { EMPTY_SPEC, isApple, type PhoneIndex, type PhoneSpec } from "@/lib/phone-catalog";
import { formatMoney } from "@/lib/money";
import { showsPta } from "@/lib/pta";

// Extra details of an "Item not in stock" line
export type UnstockedDetails = {
  mode: "phone" | "other"; // phone: picked from the catalog; other: free text
  spec: PhoneSpec;
  note: string; // short description, e.g. "box pack", "battery 85%"
  supplier: PickedSupplier | null;
  supplierPaid: string;
  supplierMethod: "cash" | "bank";
};

export const EMPTY_UNSTOCKED: UnstockedDetails = {
  mode: "phone",
  spec: EMPTY_SPEC,
  note: "",
  supplier: null,
  supplierPaid: "",
  supplierMethod: "cash",
};

const smallInput = inputClass;

export default function UnstockedLineFields({
  n,
  title,
  details,
  imei,
  pta,
  cost,
  onChange,
  index,
  catalogReady,
  canUseSupplier,
  currency,
  region = "PK",
  owedToSupplier,
}: {
  n: number;
  title: string;
  details: UnstockedDetails;
  imei: string;
  pta: string;
  cost: string;
  onChange: (patch: {
    title?: string;
    imei?: string;
    pta?: string;
    sourceCost?: string;
    u?: Partial<UnstockedDetails>;
  }) => void;
  index: PhoneIndex;
  catalogReady: boolean;
  canUseSupplier: boolean;
  currency: string;
  // "PK" (Pakistan) or "AE" (UAE): decides PTA, phone and ID formats
  region?: string;
  owedToSupplier: bigint | null;
}) {
  const phoneMode = details.mode === "phone" && catalogReady;
  const entry = index.models.get(details.spec.modelId);
  const setSpec = (patch: Partial<PhoneSpec>) => onChange({ u: { spec: { ...details.spec, ...patch } } });

  const modeButton = (value: "phone" | "other", label: string, Icon: typeof Smartphone) => (
    <button
      type="button"
      aria-pressed={details.mode === value}
      onClick={() => onChange({ u: { mode: value } })}
      className={
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors " +
        (details.mode === value ? "bg-pill text-pill-ink shadow-soft" : "text-ink-muted hover:text-ink")
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <span className="block space-y-2">
      {catalogReady && (
        <span role="group" aria-label={`Item type, line ${n}`} className="inline-flex rounded-full border border-line bg-surface-muted p-1">
          {modeButton("phone", "Phone", Smartphone)}
          {modeButton("other", "Accessory / part", Headphones)}
        </span>
      )}

      {phoneMode ? (
        <span className="block space-y-2">
          <span className="block" data-sale-field="" data-line={n - 1} data-field="name">
            <PhoneModelSearch
              index={index}
              value={details.spec.modelId}
              selectedLabel={entry?.label ?? ""}
              onPick={(option) => {
                const picked = index.models.get(option.modelId);
                onChange({
                  title: picked?.label ?? title,
                  u: {
                    spec: {
                      ...details.spec,
                      modelId: option.modelId,
                      storage: option.storage ? String(option.storage) : "",
                      ram: option.ram ? String(option.ram) : "",
                    },
                  },
                });
              }}
              onClear={() => onChange({ title: "", u: { spec: EMPTY_SPEC } })}
              label={`Phone model, line ${n}`}
            />
          </span>
          <span className="grid gap-2 sm:grid-cols-3">
            <StoragePicker
              key={`${details.spec.modelId}-storage`}
              model={entry?.model}
              value={details.spec.storage}
              onChange={(storage) => setSpec({ storage })}
              label={`Storage, line ${n}`}
            />
            {!isApple(entry?.brand) && (
              <RamPicker
                key={`${details.spec.modelId}-ram`}
                model={entry?.model}
                storage={details.spec.storage}
                value={details.spec.ram}
                onChange={(ram) => setSpec({ ram })}
                label={`RAM, line ${n}`}
              />
            )}
            <ColorPicker
              model={entry?.model}
              value={details.spec.color}
              onChange={(color) => setSpec({ color })}
              label={`Colour, line ${n}`}
            />
          </span>
        </span>
      ) : (
        <input
          data-sale-field=""
          data-line={n - 1}
          data-field="name"
          type="text"
          autoComplete="off"
          maxLength={200}
          placeholder="Item name"
          value={title}
          onChange={(e) => onChange({ title: e.target.value })}
          aria-label={`Item name, line ${n}`}
          className={smallInput}
        />
      )}

      <span className="grid gap-2 sm:grid-cols-2">
        <input
          data-sale-field=""
          data-line={n - 1}
          data-field="cost"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={`Cost price (${currency})`}
          value={cost}
          onChange={(e) => onChange({ sourceCost: e.target.value })}
          aria-label={`Cost price, line ${n}`}
          className={smallInput}
        />
        <input
          type="text"
          autoComplete="off"
          maxLength={40}
          placeholder="IMEI / serial (optional)"
          value={imei}
          onChange={(e) => onChange({ imei: e.target.value })}
          aria-label={`IMEI or serial number, line ${n}`}
          className={smallInput + " font-mono"}
        />
        <input
          type="text"
          autoComplete="off"
          maxLength={200}
          placeholder="Description, e.g. box pack, battery 85%"
          value={details.note}
          onChange={(e) => onChange({ u: { note: e.target.value } })}
          aria-label={`Description, line ${n}`}
          className={smallInput}
        />
        {showsPta(region) && (
          <PtaSelect value={pta} onChange={(value) => onChange({ pta: value })} label={`PTA status, line ${n}`} />
        )}
      </span>

      {/* Optional supplier: the cost is owed to them, minus what is paid now */}
      {canUseSupplier && (
        <span className="block space-y-2 rounded-2xl border border-dashed border-line-strong p-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Truck className="h-3.5 w-3.5 text-purple" />
            Bought from a supplier (optional)
          </span>
          {details.supplier ? (
            <span className="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-line-strong bg-surface-muted px-3">
              <span className="truncate text-sm font-semibold text-ink">{details.supplier.name}</span>
              <button
                type="button"
                onClick={() => onChange({ u: { supplier: null, supplierPaid: "" } })}
                aria-label={`Remove the supplier, line ${n}`}
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent"
              >
                <X className="h-3.5 w-3.5" />
                Remove
              </button>
            </span>
          ) : (
            <SupplierPicker
              canCreate
              label={`Supplier, line ${n}`}
              placeholder="Search or add a supplier..."
              onSelect={(supplier) => onChange({ u: { supplier } })}
            />
          )}
          {details.supplier && (
            <span className="grid gap-2 sm:grid-cols-3 sm:items-center">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={details.supplierPaid}
                onChange={(e) => onChange({ u: { supplierPaid: e.target.value } })}
                aria-label={`Paid to supplier now, line ${n}`}
                className={smallInput}
              />
              <select
                value={details.supplierMethod}
                onChange={(e) => onChange({ u: { supplierMethod: e.target.value as "cash" | "bank" } })}
                aria-label={`Supplier paid from, line ${n}`}
                className={smallInput}
              >
                <option value="cash">Paid from Cash</option>
                <option value="bank">Paid from Bank</option>
              </select>
              <span className="text-xs text-ink-muted">
                Owed to supplier:{" "}
                <span className="font-semibold text-ink">
                  {owedToSupplier === null ? "—" : formatMoney(owedToSupplier, currency)}
                </span>
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
