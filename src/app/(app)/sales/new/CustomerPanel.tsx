"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, UserRound, X } from "lucide-react";
import { inputClass, labelClass } from "@/components/ui";
import { formatMoney, toCents } from "@/lib/money";
import {
  getCustomerBalance,
  searchCustomers,
  type CustomerOption,
} from "@/app/(app)/sales/new/actions";

const DEBOUNCE_MS = 250;
const SEARCH_TIMEOUT_MS = 8000;
const TIMED_OUT = Symbol("timed-out");
const ZERO = BigInt(0);

export type CustomerValue = {
  existing: CustomerOption | null;
  name: string;
  phone: string;
};

// Pick an existing customer (by name or phone) or type a new name and phone.
export default function CustomerPanel({
  value,
  onChange,
  currency,
  required,
}: {
  value: CustomerValue;
  onChange: (value: CustomerValue) => void;
  currency: string;
  required: boolean;
}) {
  const listId = useId();
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [balance, setBalance] = useState<number | string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const balanceRequest = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function search(query: string) {
    if (timer.current) clearTimeout(timer.current);
    const id = ++requestId.current;
    setTimedOut(false);
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      let found: CustomerOption[] = [];
      let didTimeOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          searchCustomers(text),
          new Promise<typeof TIMED_OUT>((resolve) => {
            timeoutId = setTimeout(() => resolve(TIMED_OUT), SEARCH_TIMEOUT_MS);
          }),
        ]);
        if (outcome === TIMED_OUT) didTimeOut = true;
        else found = outcome;
      } catch {
        found = [];
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (id === requestId.current) {
          setResults(found);
          setTimedOut(didTimeOut);
          setHighlight(0);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
  }

  async function choose(customer: CustomerOption) {
    if (timer.current) clearTimeout(timer.current);
    requestId.current += 1;
    setLoading(false);
    setOpen(false);
    setResults([]);
    setBalance(null);
    onChange({ existing: customer, name: customer.name, phone: customer.phone ?? "" });

    const id = ++balanceRequest.current;
    try {
      const found = await getCustomerBalance(customer.id);
      if (id === balanceRequest.current) setBalance(found);
    } catch {
      // Balance is optional information
    }
  }

  function clearCustomer() {
    balanceRequest.current += 1;
    setBalance(null);
    onChange({ existing: null, name: "", phone: "" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      if (open && results[highlight]) {
        event.preventDefault();
        void choose(results[highlight]);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  const balanceCents = toCents(balance);
  const showList = open && value.name.trim().length >= 2 && (results.length > 0 || loading || timedOut);

  if (value.existing) {
    return (
      <div className="space-y-2">
        <p className={labelClass}>Customer</p>
        <div className="flex min-h-11 items-center gap-3 rounded-2xl border border-line-strong bg-surface-muted px-4 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lavender text-purple">
            <UserRound className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{value.existing.name}</span>
            <span className="block text-xs text-ink-muted">{value.existing.phone ?? "No phone"}</span>
          </span>
          <button
            type="button"
            onClick={clearCustomer}
            className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-accent"
          >
            <X className="h-3.5 w-3.5" />
            Change
          </button>
        </div>
        {balanceCents !== null && (
          <p
            className={
              "rounded-2xl px-4 py-2 text-xs font-semibold text-ink " +
              (balanceCents > ZERO ? "bg-peach" : "bg-mint")
            }
          >
            Outstanding balance: {formatMoney(balanceCents, currency)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="relative">
        <label htmlFor="sale-customer-name" className={labelClass}>
          Customer name{required ? "" : " (optional)"}
        </label>
        <input
          id="sale-customer-name"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          maxLength={120}
          placeholder="Search or type a new name"
          value={value.name}
          onChange={(event) => {
            onChange({ ...value, name: event.target.value });
            setOpen(true);
            search(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={inputClass + " pr-10"}
        />
        {loading && (
          <Loader2 className="absolute bottom-3.5 right-4 h-4 w-4 animate-spin text-ink-muted" />
        )}
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Customers"
            onMouseDown={(event) => event.preventDefault()}
            className="absolute inset-x-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-soft"
          >
            {loading && results.length === 0 && (
              <li className="px-3 py-3 text-sm text-ink-muted">Searching...</li>
            )}
            {!loading && timedOut && (
              <li role="alert" className="px-3 py-3 text-sm font-medium text-danger">
                Search is taking too long. Please try again.
              </li>
            )}
            {results.map((customer, index) => (
              <li
                key={customer.id}
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => void choose(customer)}
                className={
                  "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm " +
                  (index === highlight ? "bg-surface-muted" : "")
                }
              >
                <span className="truncate font-semibold text-ink">{customer.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">{customer.phone ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <label htmlFor="sale-customer-phone" className={labelClass}>
          Phone{required ? "" : " (optional)"}
        </label>
        <input
          id="sale-customer-phone"
          type="tel"
          autoComplete="off"
          maxLength={40}
          placeholder="03XX XXXXXXX"
          value={value.phone}
          onChange={(event) => onChange({ ...value, phone: event.target.value })}
          className={inputClass}
        />
      </div>
      <p className="text-xs text-ink-muted sm:col-span-2">
        Leave empty for a walk-in customer who pays in full. A new name and phone
        create the customer automatically.
      </p>
    </div>
  );
}
