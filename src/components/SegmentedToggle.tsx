"use client";

import { useState } from "react";

// A pill-shaped toggle. For now it only changes its own look;
// it can be wired to real data later through an onChange handler.
export default function SegmentedToggle({
  options,
  defaultValue,
  ariaLabel,
  onChange,
}: {
  options: string[];
  defaultValue?: string;
  ariaLabel: string;
  onChange?: (value: string) => void;
}) {
  const [selected, setSelected] = useState(defaultValue ?? options[0]);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-full border border-line bg-surface-muted p-1"
    >
      {options.map((option) => {
        const active = option === selected;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setSelected(option);
              onChange?.(option);
            }}
            className={
              "min-h-9 rounded-full px-4 text-xs font-semibold transition-colors " +
              (active
                ? "bg-pill text-pill-ink shadow-soft"
                : "text-ink-muted hover:text-ink")
            }
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
