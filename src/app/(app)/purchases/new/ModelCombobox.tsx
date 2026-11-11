"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { inputClass } from "@/components/ui";

export type ModelOption = { id: string; label: string };

const MAX_RESULTS = 8;

// Searchable "Brand Model" picker for one grid cell.
// Enter picks the highlighted model and lets the grid move to the next cell.
export default function ModelCombobox({
  models,
  value,
  onChange,
  canAddModels,
  onReload,
  reloading,
  label,
}: {
  models: ModelOption[];
  value: string;
  onChange: (modelId: string) => void;
  canAddModels: boolean;
  onReload: () => void;
  reloading: boolean;
  label: string;
}) {
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const selected = models.find((m) => m.id === value) ?? null;
  const search = query.trim().toLowerCase();
  const matches = (
    search ? models.filter((m) => m.label.toLowerCase().includes(search)) : models
  ).slice(0, MAX_RESULTS);
  const open = editing && (search !== "" || matches.length > 0);

  function pick(option: ModelOption) {
    onChange(option.id);
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
      setEditing(true);
      setHighlight((h) =>
        matches.length ? (h - 1 + matches.length) % matches.length : 0
      );
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      // Pick and let the grid move focus to the next cell
      if (open && matches[highlight]) pick(matches[highlight]);
    } else if (event.key === "Escape") {
      if (editing) {
        event.preventDefault();
        setEditing(false);
        setQuery("");
      }
    }
  }

  const activeId =
    open && matches[highlight] ? `${listId}-option-${highlight}` : undefined;

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        placeholder="Type to search, e.g. iP or sam"
        value={editing ? query : selected?.label ?? ""}
        onFocus={(event) => {
          setEditing(true);
          setQuery("");
          setHighlight(0);
          event.target.select();
        }}
        onBlur={() => {
          setEditing(false);
          setQuery("");
        }}
        onChange={(event) => {
          setEditing(true);
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className={inputClass}
      />

      {open && (
        <div
          // Keep focus in the input while tapping inside the list
          onMouseDown={(event) => event.preventDefault()}
          className="absolute inset-x-0 top-full z-40 mt-2 rounded-2xl border border-line bg-surface p-1.5 shadow-soft"
        >
          {matches.length > 0 ? (
            <ul id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
              {matches.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(option)}
                  className={
                    "flex min-h-11 cursor-pointer items-center rounded-xl px-3 py-2 text-sm font-medium text-ink " +
                    (index === highlight ? "bg-surface-muted" : "")
                  }
                >
                  {option.label}
                </li>
              ))}
            </ul>
          ) : (
            <div id={listId} className="space-y-2 px-3 py-3 text-sm">
              <p className="text-ink-muted">No model matches &quot;{query.trim()}&quot;.</p>
              {canAddModels ? (
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/catalog/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-xs font-semibold text-accent-ink"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Add a new model
                  </a>
                  <button
                    type="button"
                    onClick={onReload}
                    disabled={reloading}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-xs font-semibold text-ink disabled:opacity-60"
                  >
                    <RefreshCw className={"h-3.5 w-3.5 " + (reloading ? "animate-spin" : "")} />
                    Reload models
                  </button>
                </div>
              ) : (
                <p className="font-medium text-ink">Ask a manager to add this model.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
