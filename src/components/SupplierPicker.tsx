"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import {
  createSupplier,
  searchSuppliers,
  type SupplierOption,
} from "@/app/(app)/suppliers/actions";
import { inputClass } from "@/components/ui";

export type PickedSupplier = SupplierOption;

type Option =
  | { kind: "supplier"; supplier: PickedSupplier }
  | { kind: "create"; name: string };

const DEBOUNCE_MS = 250;

// A type-ahead supplier search. Reusable in the purchase screens.
// - onSelect: called with the chosen (or newly created) supplier
// - canCreate: show "Add ... as a new supplier" when there is no exact match
// - onCreate: optional. When given, the parent decides how to create;
//   otherwise the picker creates the supplier by name and selects it.
export default function SupplierPicker({
  onSelect,
  canCreate = false,
  onCreate,
  placeholder = "Search suppliers...",
  autoFocus = false,
  label = "Search suppliers",
}: {
  onSelect: (supplier: PickedSupplier) => void;
  canCreate?: boolean;
  onCreate?: (name: string) => void | Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [results, setResults] = useState<PickedSupplier[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear a pending search when the component goes away
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const trimmed = text.trim().replace(/\s+/g, " ");
  const exactMatch = results.some(
    (s) => s.name.toLowerCase() === trimmed.toLowerCase()
  );
  const options: Option[] = results.map((supplier) => ({
    kind: "supplier",
    supplier,
  }));
  if (canCreate && trimmed && !exactMatch && !loading) {
    options.push({ kind: "create", name: trimmed });
  }

  function search(value: string) {
    if (timer.current) clearTimeout(timer.current);
    const query = value.trim();
    if (!query) {
      requestId.current += 1;
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const id = ++requestId.current;
      let found: PickedSupplier[] = [];
      try {
        found = await searchSuppliers(query);
      } catch {
        found = [];
      }
      // Ignore answers to older searches
      if (id !== requestId.current) return;
      setResults(found);
      setHighlight(0);
      setLoading(false);
    }, DEBOUNCE_MS);
  }

  function reset() {
    requestId.current += 1;
    setText("");
    setResults([]);
    setOpen(false);
    setHighlight(0);
  }

  async function choose(option: Option) {
    setError(null);
    if (option.kind === "supplier") {
      onSelect(option.supplier);
      reset();
      return;
    }

    setBusy(true);
    try {
      if (onCreate) {
        await onCreate(option.name);
        reset();
      } else {
        const created = await createSupplier({ name: option.name });
        if (created.ok && created.supplier) {
          onSelect(created.supplier);
          reset();
        } else {
          setError(created.error ?? "The supplier could not be added.");
        }
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (options.length ? (h + 1) % options.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        options.length ? (h - 1 + options.length) % options.length : 0
      );
    } else if (event.key === "Enter") {
      if (open && options[highlight]) {
        event.preventDefault();
        void choose(options[highlight]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  const showList = open && trimmed !== "" && (options.length > 0 || loading);
  const activeId =
    showList && options[highlight] ? `${listId}-option-${highlight}` : undefined;

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={text}
        readOnly={busy}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setError(null);
          search(event.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={inputClass + " pl-10 pr-10"}
      />
      {(loading || busy) && (
        <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" />
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          // Keep focus in the input while tapping an option
          onMouseDown={(event) => event.preventDefault()}
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-soft"
        >
          {loading && options.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-muted">Searching...</li>
          )}
          {options.map((option, index) => {
            const active = index === highlight;
            const base =
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm " +
              (active ? "bg-surface-muted text-ink" : "text-ink");
            return option.kind === "supplier" ? (
              <li
                key={option.supplier.id}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => void choose(option)}
                className={base}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {option.supplier.name}
                </span>
                {option.supplier.phone && (
                  <span className="shrink-0 text-xs text-ink-muted">
                    {option.supplier.phone}
                  </span>
                )}
              </li>
            ) : (
              <li
                key="create"
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => void choose(option)}
                className={base + " font-semibold text-accent"}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">
                  Add &quot;{option.name}&quot; as a new supplier
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {open && trimmed !== "" && !loading && options.length === 0 && (
        <p className="mt-2 text-xs text-ink-muted">No matching suppliers.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
