"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Headphones, Loader2, Search, Smartphone } from "lucide-react";
import { inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { searchSaleItems, type SaleItemOption } from "@/app/(app)/sales/new/actions";

const DEBOUNCE_MS = 250;
// Give up on a search after this long so the spinner can never hang
const SEARCH_TIMEOUT_MS = 8000;
const TIMED_OUT = Symbol("timed-out");

function optionKey(option: SaleItemOption) {
  return option.kind === "phone" ? `p-${option.phone_unit_id}` : `a-${option.product_id}`;
}

// One "Add item" box that finds in-stock phones (by IMEI, brand or model)
// and accessories (by name).
export default function SaleItemSearch({
  onPick,
  excludePhoneIds,
  currency,
  inputRef,
}: {
  onPick: (option: SaleItemOption) => void;
  excludePhoneIds: Set<string>;
  currency: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [results, setResults] = useState<SaleItemOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Phones already on the invoice are hidden
  const options = results.filter(
    (o) => o.kind !== "phone" || !excludePhoneIds.has(o.phone_unit_id)
  );
  const trimmed = text.trim();

  function search(value: string) {
    if (timer.current) clearTimeout(timer.current);
    // A new id on every keystroke, so older answers are always ignored
    const id = ++requestId.current;
    setTimedOut(false);
    setError(null);
    const query = value.trim();
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      let found: SaleItemOption[] = [];
      let didTimeOut = false;
      let message: string | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          searchSaleItems(query),
          new Promise<typeof TIMED_OUT>((resolve) => {
            timeoutId = setTimeout(() => resolve(TIMED_OUT), SEARCH_TIMEOUT_MS);
          }),
        ]);
        if (outcome === TIMED_OUT) didTimeOut = true;
        else if (outcome.ok) found = outcome.items;
        else message = outcome.error;
      } catch {
        message = "Items could not be searched. Please try again.";
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        // Only the latest search may update the list and stop the spinner
        if (id === requestId.current) {
          setResults(found);
          setTimedOut(didTimeOut);
          setError(message);
          setHighlight(0);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    requestId.current += 1;
    setText("");
    setResults([]);
    setOpen(false);
    setHighlight(0);
    setTimedOut(false);
    setError(null);
    setLoading(false);
  }

  function choose(option: SaleItemOption) {
    reset();
    onPick(option);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (options.length ? (h + 1) % options.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (options.length ? (h - 1 + options.length) % options.length : 0));
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (open && options[highlight]) choose(options[highlight]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  const showList = open && trimmed !== "";
  const activeId =
    showList && options[highlight] ? `${listId}-option-${highlight}` : undefined;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Add item"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        autoFocus
        placeholder="Add item: scan IMEI, type the last digits, a model or an accessory..."
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          search(event.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={inputClass + " min-h-12 pl-11 pr-10 text-base"}
      />
      {loading && (
        <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" />
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Items in stock"
          // Keep focus in the input while tapping an option
          onMouseDown={(event) => event.preventDefault()}
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-soft"
        >
          {loading && options.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-muted">Searching...</li>
          )}
          {!loading && timedOut && (
            <li role="alert" className="px-3 py-3 text-sm font-medium text-danger">
              Search is taking too long. Please try again.
            </li>
          )}
          {!loading && !timedOut && error && (
            <li role="alert" className="px-3 py-3 text-sm font-medium text-danger">
              {error}
            </li>
          )}
          {!loading && !timedOut && !error && options.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-muted">No item in stock matches.</li>
          )}
          {options.map((option, index) => {
            const active = index === highlight;
            return (
              <li
                key={optionKey(option)}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
                className={
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm " +
                  (active ? "bg-surface-muted" : "")
                }
              >
                <span
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
                    (option.kind === "phone" ? "bg-aqua text-accent" : "bg-peach text-coral")
                  }
                >
                  {option.kind === "phone" ? (
                    <Smartphone className="h-4 w-4" />
                  ) : (
                    <Headphones className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  {option.kind === "phone" ? (
                    <>
                      <span className="block truncate font-semibold text-ink">
                        {option.model}
                        {option.storage ? ` · ${option.storage}` : ""}
                        {option.color ? ` · ${option.color}` : ""}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {option.condition ? `${option.condition} · ` : ""}IMEI{" "}
                        <span className="font-mono">{option.imei}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block truncate font-semibold text-ink">{option.name}</span>
                      <span className="block text-xs text-ink-muted">In stock: {option.in_stock}</span>
                    </>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs font-semibold text-ink">
                  {option.sale_price === null ? "No price" : formatMoney(option.sale_price, currency)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
