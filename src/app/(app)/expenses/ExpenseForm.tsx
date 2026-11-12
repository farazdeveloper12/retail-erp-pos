"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Receipt } from "lucide-react";
import { Notice, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { cleanMoneyInput, isValidMoneyInput, toCents } from "@/lib/money";
import { recordExpense } from "@/app/(app)/expenses/actions";

// Fast entry: fill in and press Enter; the form clears for the next expense.
export default function ExpenseForm({
  today,
  categories,
  currency,
}: {
  today: string;
  categories: string[];
  currency: string;
}) {
  const categoryRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amountCents = isValidMoneyInput(amount) ? toCents(amount) : null;
  const valid = category.trim() !== "" && amountCents !== null && amountCents > BigInt(0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!valid) {
      setError(
        category.trim() === "" ? "Category is required." : "Enter an amount above zero with up to 2 decimals."
      );
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await recordExpense({
          expense_date: date,
          category: category.trim(),
          description: description.trim(),
          amount: Number(cleanMoneyInput(amount)),
          payment_method: method,
        });
        if (result.ok) {
          setSuccess(`Saved: ${category.trim()}.`);
          // Keep the date and method for the next expense
          setCategory("");
          setDescription("");
          setAmount("");
          categoryRef.current?.focus();
        } else {
          setError(result.error ?? "The expense could not be saved.");
        }
      } catch {
        setError("The expense could not be saved. Please check your connection and try again.");
      }
    });
  }

  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-pill text-pill-ink">
          <Receipt className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">Add expense</h2>
          <p className="text-xs text-ink-muted">Fill in and press Enter to save.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-end">
          <div>
            <label htmlFor="expense-date" className={labelClass}>
              Date
            </label>
            <input
              id="expense-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="expense-category" className={labelClass}>
              Category
            </label>
            <input
              ref={categoryRef}
              id="expense-category"
              type="text"
              list="expense-category-options"
              required
              maxLength={60}
              autoComplete="off"
              autoFocus
              placeholder="e.g. Rent"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            />
            <datalist id="expense-category-options">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="expense-description" className={labelClass}>
              Description (optional)
            </label>
            <input
              id="expense-description"
              type="text"
              maxLength={500}
              autoComplete="off"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="expense-amount" className={labelClass}>
              Amount ({currency})
            </label>
            <input
              id="expense-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="expense-method" className={labelClass}>
              Paid from
            </label>
            <select
              id="expense-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as "cash" | "bank")}
              className={inputClass}
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
          </div>
          <button type="submit" disabled={pending} className={primaryButtonClass + " w-full md:w-auto"}>
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}
      </form>
    </section>
  );
}
