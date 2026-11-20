"use client";

import { useId, useState } from "react";
import { inputClass } from "@/components/ui";
import type { CatalogModel } from "@/app/(app)/purchases/new/actions";
import { colorOptions, parseStorage, ramOptions, storageLabel, storageOptions } from "@/lib/phone-catalog";
import { PTA_OPTIONS } from "@/lib/pta";

const OTHER = "__other__";

// Storage: the model's known sizes plus "Other" (free entry like 512 or 1TB)
export function StoragePicker({
  model,
  value,
  onChange,
  label,
}: {
  model: CatalogModel | undefined;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const options = storageOptions(model);
  const parsed = parseStorage(value);
  const known = parsed !== null && options.includes(parsed);
  const [other, setOther] = useState(false);
  const showInput = other || (value.trim() !== "" && !known);

  if (showInput) {
    return (
      <div className="flex gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          placeholder="e.g. 256 or 1TB"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setOther(false);
              onChange("");
            }}
            className="shrink-0 rounded-xl px-2 text-xs font-semibold text-accent"
          >
            List
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      aria-label={label}
      value={known ? String(parsed) : ""}
      onChange={(e) => {
        if (e.target.value === OTHER) {
          setOther(true);
          onChange("");
        } else onChange(e.target.value);
      }}
      disabled={!model}
      className={inputClass + " disabled:opacity-60"}
    >
      <option value="">{model ? "Choose" : "Pick a model"}</option>
      {options.map((gb) => (
        <option key={gb} value={gb}>
          {storageLabel(gb)}
        </option>
      ))}
      <option value={OTHER}>Other…</option>
    </select>
  );
}

// RAM (not for Apple): known sizes for the storage, "Not given" or "Other"
export function RamPicker({
  model,
  storage,
  value,
  onChange,
  label,
}: {
  model: CatalogModel | undefined;
  storage: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const options = ramOptions(model, parseStorage(storage));
  const known = value === "" || options.includes(Number(value));
  const [other, setOther] = useState(false);

  if (other || !known) {
    return (
      <div className="flex gap-1.5">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          placeholder="GB"
          maxLength={2}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => {
            setOther(false);
            onChange("");
          }}
          className="shrink-0 rounded-xl px-2 text-xs font-semibold text-accent"
        >
          List
        </button>
      </div>
    );
  }

  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (e.target.value === OTHER) {
          setOther(true);
          onChange("");
        } else onChange(e.target.value);
      }}
      disabled={!model}
      className={inputClass + " disabled:opacity-60"}
    >
      <option value="">Not given</option>
      {options.map((gb) => (
        <option key={gb} value={gb}>
          {gb} GB
        </option>
      ))}
      <option value={OTHER}>Other…</option>
    </select>
  );
}

// Colour: free text with the model's colours and common colours as suggestions
export function ColorPicker({
  model,
  value,
  onChange,
  label,
}: {
  model: CatalogModel | undefined;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        type="text"
        list={listId}
        autoComplete="off"
        maxLength={60}
        aria-label={label}
        placeholder="Optional"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      <datalist id={listId}>
        {colorOptions(model).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

// PTA status (Pakistan): "" = not known
export function PtaSelect({
  value,
  onChange,
  label,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
}) {
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">Not known</option>
      {PTA_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
