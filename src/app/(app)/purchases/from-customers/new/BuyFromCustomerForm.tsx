"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins } from "lucide-react";
import { Notice, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { loadPurchaseCatalog, type CatalogBrand } from "@/app/(app)/purchases/new/actions";
import { buyFromCustomer } from "@/app/(app)/purchases/from-customers/actions";
import TradeInFields from "@/app/(app)/purchases/from-customers/TradeInFields";
import { EMPTY_TRADE_IN, cleanImei, tradeInPayload, tradeInProblems, type TradeInDraft } from "@/lib/trade-in";

export default function BuyFromCustomerForm({
  currency,
  today,
  initialBrands,
}: {
  currency: string;
  today: string;
  initialBrands: CatalogBrand[] | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<TradeInDraft>(EMPTY_TRADE_IN);
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [date, setDate] = useState(today);
  const [brands, setBrands] = useState<CatalogBrand[] | null>(initialBrands);
  const [loading, setLoading] = useState(false);
  const [stockCheck, setStockCheck] = useState<{ imei: string; inStock: boolean } | null>(null);
  const onImeiChecked = useCallback((imei: string, inStock: boolean) => setStockCheck({ imei, inStock }), []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadPurchaseCatalog();
      if (result.ok) setBrands(result.brands);
      else setError(result.error ?? "The models could not be loaded.");
    } catch {
      setError("The models could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const problems = tradeInProblems(draft);
  if (stockCheck?.inStock && stockCheck.imei === cleanImei(draft.imei)) {
    problems.unshift("This IMEI is already in stock.");
  }
  if (!date) problems.push("Choose the date.");
  const canSave = problems.length === 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await buyFromCustomer({
        ...tradeInPayload(draft),
        payment_method: method,
        purchase_date: date,
      });
      if (result.ok && result.id) {
        router.push(`/purchases/from-customers/${result.id}?print=1`);
        return;
      }
      setError(result.error ?? "The phone could not be saved.");
    } catch {
      setError("The phone could not be saved. Please check your connection and try again.");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <TradeInFields
          idPrefix="buy"
          value={draft}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          brands={brands}
          loadingCatalog={loading}
          onReloadCatalog={loadCatalog}
          currency={currency}
          priceLabel="Buy price"
          onImeiChecked={onImeiChecked}
        />
      </section>

      <section className={cardClass + " space-y-4"}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="buy-method" className={labelClass}>
              Pay from
            </label>
            <select
              id="buy-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as "cash" | "bank")}
              className={inputClass}
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
            <p className="mt-1 text-xs text-ink-muted">The account must hold enough money.</p>
          </div>
          <div>
            <label htmlFor="buy-date" className={labelClass}>
              Date
            </label>
            <input
              id="buy-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          The phone goes into stock as Used, with the buy price as its cost. A purchase slip opens after saving.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" onClick={() => void save()} disabled={!canSave} className={primaryButtonClass}>
            <HandCoins className="h-4 w-4" />
            {saving ? "Saving..." : "Buy phone and print slip"}
          </button>
          {problems.length > 0 && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              {problems[0]}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
