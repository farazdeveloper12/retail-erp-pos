"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { labelClass } from "@/components/ui";
import PhoneModelSearch from "@/components/phone/PhoneModelSearch";
import QuickAddModelForm from "@/components/phone/QuickAddModelForm";
import { ColorPicker, PtaSelect, RamPicker, StoragePicker } from "@/components/phone/PhoneOptionPickers";
import { isApple, type PhoneIndex, type PhoneSpec } from "@/lib/phone-catalog";

// Model (type-ahead), storage, RAM (not for Apple), colour and, for PKR
// shops, PTA status: one block used by trade-in, buy from customer and the
// "not in stock" card.
export default function PhoneSpecFields({
  idPrefix,
  index,
  loading,
  onReloadCatalog,
  spec,
  onChange,
  pta,
  onPtaChange,
  showPta,
  canQuickAdd,
}: {
  idPrefix: string;
  index: PhoneIndex;
  loading: boolean;
  onReloadCatalog: () => Promise<void>;
  spec: PhoneSpec;
  onChange: (patch: Partial<PhoneSpec>) => void;
  pta: string;
  onPtaChange: (value: string) => void;
  showPta: boolean;
  canQuickAdd: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const entry = index.models.get(spec.modelId);
  const apple = isApple(entry?.brand);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <span className={labelClass}>Phone model</span>
          {loading && index.options.length === 0 ? (
            <p className="flex min-h-11 items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading models...
            </p>
          ) : (
            <PhoneModelSearch
              index={index}
              value={spec.modelId}
              selectedLabel={entry?.label ?? ""}
              onPick={(option) =>
                onChange({
                  modelId: option.modelId,
                  storage: option.storage ? String(option.storage) : "",
                  ram: option.ram ? String(option.ram) : "",
                })
              }
              onClear={() => onChange({ modelId: "", storage: "", ram: "", color: "" })}
              onQuickAdd={canQuickAdd ? (q) => setAdding(q) : undefined}
              onReload={() => void onReloadCatalog()}
              reloading={loading}
              label="Phone model"
            />
          )}
        </div>
        <div>
          <span className={labelClass}>Storage</span>
          <StoragePicker
            key={`${spec.modelId}-storage`}
            model={entry?.model}
            value={spec.storage}
            onChange={(storage) => onChange({ storage })}
            label="Storage"
          />
        </div>
        {!apple && (
          <div>
            <span className={labelClass}>RAM (optional)</span>
            <RamPicker
              key={`${spec.modelId}-ram`}
              model={entry?.model}
              storage={spec.storage}
              value={spec.ram}
              onChange={(ram) => onChange({ ram })}
              label="RAM"
            />
          </div>
        )}
        <div>
          <span className={labelClass}>Colour</span>
          <ColorPicker model={entry?.model} value={spec.color} onChange={(color) => onChange({ color })} label="Colour" />
        </div>
        {showPta && (
          <div>
            <label htmlFor={`${idPrefix}-pta`} className={labelClass}>
              PTA status
            </label>
            <PtaSelect id={`${idPrefix}-pta`} value={pta} onChange={onPtaChange} label="PTA status" />
          </div>
        )}
      </div>

      {adding !== null && (
        <QuickAddModelForm
          query={adding}
          brandNames={index.brandNames}
          onCancel={() => setAdding(null)}
          onAdded={async (added) => {
            await onReloadCatalog();
            onChange({ modelId: added.modelId, storage: added.storage, ram: added.ram });
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
