"use client";

import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { AlertTriangle, X } from "lucide-react";

// Luhn check. Some genuine phones fail it, so this is only a warning.
export function passesLuhn(imei: string): boolean {
  let sum = 0;
  for (let i = 0; i < imei.length; i += 1) {
    let digit = Number(imei[imei.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function splitImeis(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// Chip input: type or scan an IMEI and press Enter or Tab; paste many at once.
// The parent validates and returns a message for rejected values.
export default function ImeiInput({
  imeis,
  inStock,
  onAdd,
  onRemove,
  label,
}: {
  imeis: string[];
  inStock: Set<string>;
  onAdd: (values: string[]) => string | null;
  onRemove: (imei: string) => void;
  label: string;
}) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function add(values: string[]) {
    if (values.length === 0) return;
    setMessage(onAdd(values));
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const value = text.trim();
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      // With text: add it and stay here (scanners press Enter after each code).
      // Without text: let the grid move to the next cell.
      if (value) {
        event.preventDefault();
        add(splitImeis(value));
      }
    } else if (event.key === "Backspace" && !text && imeis.length > 0) {
      onRemove(imeis[imeis.length - 1]);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    const values = splitImeis(pasted);
    if (values.length > 1 || /[\s,;]/.test(pasted.trim())) {
      event.preventDefault();
      add(values);
    }
  }

  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-2xl border border-line-strong bg-surface px-2 py-1.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
        {imeis.map((imei) => {
          const stocked = inStock.has(imei);
          const luhnOk = passesLuhn(imei);
          return (
            <span
              key={imei}
              className={
                "inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 tabular-nums text-xs " +
                (stocked ? "bg-danger-soft text-danger" : "bg-surface-muted text-ink")
              }
              title={
                stocked
                  ? "This IMEI is already in stock"
                  : luhnOk
                    ? undefined
                    : "This IMEI fails the Luhn check. Some phones do; please double-check it."
              }
            >
              {!luhnOk && !stocked && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber" aria-label="Luhn check failed" />
              )}
              {imei}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onRemove(imei)}
                aria-label={`Remove IMEI ${imei}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          placeholder={imeis.length ? "Add more..." : "Scan or type IMEI"}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (message) setMessage(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          // Tab (or tapping elsewhere) adds what was typed
          onBlur={() => {
            if (text.trim()) add(splitImeis(text));
          }}
          className="min-h-8 min-w-[9rem] flex-1 bg-transparent px-1 tabular-nums text-sm text-ink outline-none placeholder:font-sans placeholder:text-ink-muted/70"
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink-muted">
          {imeis.length} IMEI
        </span>
        {message && (
          <span role="alert" className="font-medium text-danger">
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
