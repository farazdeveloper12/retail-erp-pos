"use client";

import { useCallback, useState } from "react";
import { Repeat, X } from "lucide-react";
import { primaryButtonClass } from "@/components/ui";
import type { CatalogBrand } from "@/app/(app)/purchases/new/actions";
import TradeInFields from "@/app/(app)/purchases/from-customers/TradeInFields";
import { cleanImei, tradeInProblems, type TradeInDraft } from "@/lib/trade-in";

// Inline card (a bottom sheet on phones) for the customer's old phone.
// Its value pays part of the invoice; the phone goes into stock as Used.
export default function TradeInCard({
  initial,
  brands,
  loadingCatalog,
  onReloadCatalog,
  currency,
  usedImeis,
  onSave,
  onClose,
}: {
  initial: TradeInDraft;
  brands: CatalogBrand[] | null;
  loadingCatalog: boolean;
  onReloadCatalog: () => Promise<void>;
  currency: string;
  usedImeis: Set<string>;
  onSave: (draft: TradeInDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TradeInDraft>(initial);
  const [stockCheck, setStockCheck] = useState<{ imei: string; inStock: boolean } | null>(null);
  const onImeiChecked = useCallback((imei: string, inStock: boolean) => setStockCheck({ imei, inStock }), []);

  const imei = cleanImei(draft.imei);
  const problems = tradeInProblems(draft);
  if (stockCheck?.inStock && stockCheck.imei === imei) problems.unshift("This IMEI is already in stock.");
  if (usedImeis.has(imei)) problems.unshift("This IMEI is already on this invoice.");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Trade-in"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented) {
            e.stopPropagation();
            onClose();
          }
        }}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-card border border-line bg-surface p-4 shadow-soft md:static md:z-auto md:max-h-none md:rounded-card md:border-2 md:border-dashed md:border-accent/40 md:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lavender text-purple">
              <Repeat className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-ink">Trade-in: the customer&apos;s old phone</h3>
              <p className="text-xs text-ink-muted">
                Its value is taken off what the customer pays. The invoice total and VAT do not change.
              </p>
            </div>
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

        <TradeInFields
          idPrefix="trade-in"
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          brands={brands}
          loadingCatalog={loadingCatalog}
          onReloadCatalog={onReloadCatalog}
          currency={currency}
          priceLabel="Trade-in value"
          onImeiChecked={onImeiChecked}
        />

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={problems.length > 0}
            className={primaryButtonClass + " w-full sm:w-auto"}
          >
            <Repeat className="h-4 w-4" />
            Use as trade-in
          </button>
          {problems.length > 0 && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              {problems[0]}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
