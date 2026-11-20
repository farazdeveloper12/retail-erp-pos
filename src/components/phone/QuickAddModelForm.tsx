"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Notice, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { quickAddPhoneModel } from "@/app/(app)/purchases/from-customers/actions";
import { isApple, parseStorage } from "@/lib/phone-catalog";

export type QuickAdded = { modelId: string; storage: string; ram: string };

// Adds a missing phone model to the shared catalog in one step and chooses it.
// The typed text may start with a known brand: "Samsung Galaxy A06".
export default function QuickAddModelForm({
  query,
  brandNames,
  onAdded,
  onCancel,
}: {
  query: string;
  brandNames: string[];
  onAdded: (added: QuickAdded) => Promise<void> | void;
  onCancel: () => void;
}) {
  const id = useId();
  const knownBrand = brandNames.find((b) => query.toLowerCase().startsWith(b.toLowerCase() + " "));
  const [brand, setBrand] = useState(knownBrand ?? "");
  const [model, setModel] = useState(knownBrand ? query.slice(knownBrand.length).trim() : query);
  const [storage, setStorage] = useState("128");
  const [ram, setRam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const apple = isApple(brand);

  async function save() {
    const storageGb = parseStorage(storage);
    if (storageGb === null) {
      setError("Enter the storage, for example 128 or 1TB.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await quickAddPhoneModel({
        brand,
        model,
        storage_gb: storageGb,
        ram_gb: !apple && ram.trim() ? Number(ram) : null,
      });
      if (!result.ok || !result.modelId) {
        setError(result.error ?? "The model could not be added.");
        return;
      }
      await onAdded({ modelId: result.modelId, storage: String(storageGb), ram: apple ? "" : ram.trim() });
    } catch {
      setError("The model could not be added. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-dashed border-accent/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">Add a new phone model</p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor={`${id}-brand`} className={labelClass}>
            Brand
          </label>
          <input
            id={`${id}-brand`}
            list={`${id}-brands`}
            type="text"
            maxLength={60}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className={inputClass}
          />
          <datalist id={`${id}-brands`}>
            {brandNames.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor={`${id}-model`} className={labelClass}>
            Model name
          </label>
          <input
            id={`${id}-model`}
            type="text"
            maxLength={100}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-storage`} className={labelClass}>
            Storage
          </label>
          <input
            id={`${id}-storage`}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 128 or 1TB"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            className={inputClass}
          />
        </div>
        {!apple && (
          <div>
            <label htmlFor={`${id}-ram`} className={labelClass}>
              RAM in GB (optional)
            </label>
            <input
              id={`${id}-ram`}
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={ram}
              onChange={(e) => setRam(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
            />
          </div>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        The phone catalog is shared. If this model already exists, it is chosen instead of added twice.
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !brand.trim() || !model.trim()}
          className={primaryButtonClass}
        >
          <Plus className="h-4 w-4" />
          {saving ? "Adding..." : "Add and choose"}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </div>
  );
}
