"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { inputClass } from "@/components/ui";
import { searchPhones, type PhoneIndex, type SearchOption } from "@/lib/phone-catalog";

// Type-ahead phone picker: "iph 15 pro 256" suggests "Apple iPhone 15 Pro 256GB".
// Picking a suggestion with a storage sets the model and its storage/RAM.
export default function PhoneModelSearch({
  index,
  value,
  selectedLabel,
  onPick,
  onClear,
  onQuickAdd,
  onReload,
  reloading,
  label,
  autoFocus,
}: {
  index: PhoneIndex;
  value: string; // the chosen model id ("" = none)
  selectedLabel: string; // what to show when a model is chosen
  onPick: (option: SearchOption) => void;
  onClear?: () => void;
  // When given, a missing model can be added with the typed name
  onQuickAdd?: (query: string) => void;
  onReload?: () => void;
  reloading?: boolean;
  label: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => searchPhones(index, query), [index, query]);
  const open = editing && query.trim() !== "";

  function pick(option: SearchOption) {
    onPick(option);
    setEditing(false);
    setQuery("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setEditing(true);
      setHighlight((h) => (matches.length ? (h + 1) % matches.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (matches.length ? (h - 1 + matches.length) % matches.length : 0));
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      if (open && matches[highlight]) {
        event.preventDefault();
        pick(matches[highlight]);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setEditing(false);
      setQuery("");
    }
  }

  const showingSelected = !editing && value !== "";

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Type brand, model or storage, e.g. iph 15 pro 256"
          value={showingSelected ? selectedLabel : query}
          onFocus={() => {
            setEditing(true);
            setQuery("");
            setHighlight(0);
          }}
          onBlur={() => window.setTimeout(() => setEditing(false), 150)}
          onChange={(e) => {
            setEditing(true);
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          className={inputClass + (showingSelected ? " pr-11 font-semibold" : "")}
        />
        {showingSelected && onClear && (
          <button
            type="button"
            aria-label="Clear the phone model"
            onClick={onClear}
            className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          {matches.length > 0 ? (
            <ul id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1">
              {matches.map((option, i) => (
                <li
                  key={option.key}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(option)}
                  className={
                    "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-ink " +
                    (i === highlight ? "bg-surface-muted" : "")
                  }
                >
                  <span className="font-medium">{option.label}</span>
                  {option.year > 0 && <span className="text-xs text-ink-muted">{option.year}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div id={listId} className="space-y-2 px-3 py-3 text-sm">
              <p className="text-ink-muted">No phone matches &quot;{query.trim()}&quot;.</p>
              <div className="flex flex-wrap gap-2">
                {onQuickAdd && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onQuickAdd(query.trim());
                      setEditing(false);
                    }}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-xs font-semibold text-accent-ink"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add &quot;{query.trim()}&quot; as a new model
                  </button>
                )}
                {onReload && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onReload}
                    disabled={reloading}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink disabled:opacity-60"
                  >
                    <RefreshCw className={"h-3.5 w-3.5 " + (reloading ? "animate-spin" : "")} />
                    Reload models
                  </button>
                )}
              </div>
              {!onQuickAdd && <p className="font-medium text-ink">Ask a manager to add this model.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
