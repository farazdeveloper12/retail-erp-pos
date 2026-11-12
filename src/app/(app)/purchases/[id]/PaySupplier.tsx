"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Wallet } from "lucide-react";
import { Notice, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { cleanMoneyInput, formatMoney, isValidMoneyInput, toCents } from "@/lib/money";
import { paySupplier } from "@/app/(app)/purchases/[id]/actions";

// Small form to pay the supplier later. The page reloads its data after saving.
export default function PaySupplier({
  purchaseId,
  remaining,
  currency,
}: {
  purchaseId: string;
  remaining: string; // plain decimal, for example "1500.50"
  currency: string;
}) {
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remainingCents = toCents(remaining);
  const amountCents = isValidMoneyInput(amount) ? toCents(amount) : null;
  const tooMuch =
    amountCents !== null && remainingCents !== null && amountCents > remainingCents;
  const valid = amountCents !== null && amountCents > BigInt(0) && !tooMuch;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || pending) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await paySupplier({
          purchase_id: purchaseId,
          amount: Number(cleanMoneyInput(amount)),
          payment_method: method,
        });
        if (result.ok) {
          setSuccess(
            result.balance === null
              ? "Payment saved."
              : `Payment saved. Remaining balance: ${formatMoney(result.balance, currency)}.`
          );
        } else {
          setError(result.error ?? "The payment could not be saved.");
        }
      } catch {
        setError("The payment could not be saved. Please check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-accent" />
        <h2 className="text-base font-bold text-ink">Pay supplier</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-end">
        <div>
          <label htmlFor="pay-amount" className={labelClass}>
            Amount ({currency})
          </label>
          <input
            id="pay-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="pay-method" className={labelClass}>
            Method
          </label>
          <select
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value as "cash" | "bank")}
            className={inputClass}
          >
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => setAmount(remaining)}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-mint px-4 text-xs font-semibold text-ink"
        >
          Full remaining
        </button>
      </div>
      {tooMuch && (
        <p className="text-xs font-medium text-danger">
          The amount cannot be more than the remaining balance.
        </p>
      )}
      <button
        type="submit"
        disabled={!valid || pending}
        className={primaryButtonClass + " w-full sm:w-auto"}
      >
        {pending ? "Saving..." : "Save payment"}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
    </form>
  );
}
