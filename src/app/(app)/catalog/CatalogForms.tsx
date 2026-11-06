"use client";

import { useActionState } from "react";
import {
  addBrand,
  addColor,
  addVariant,
  createModel,
  setActive,
  updateModel,
  type FormState,
} from "@/app/(app)/catalog/actions";
import { PRODUCT_TYPE_LABELS } from "@/lib/catalog";

const initialState: FormState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-slate-950";

const buttonClass =
  "rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60";

function Message({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      >
        {state.success}
      </p>
    );
  }
  return null;
}

function valueOf(
  state: FormState,
  defaults: Record<string, string> | undefined,
  name: string
) {
  return state.values?.[name] ?? defaults?.[name] ?? "";
}

function Field({
  formId,
  name,
  label,
  state,
  defaults,
  required = false,
  hint,
  placeholder,
  inputMode,
}: {
  formId: string;
  name: string;
  label: string;
  state: FormState;
  defaults?: Record<string, string>;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "url";
}) {
  const id = `${formId}-${name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        required={required}
        placeholder={placeholder}
        inputMode={inputMode}
        defaultValue={valueOf(state, defaults, name)}
        className={inputClass}
      />
      {hint && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  );
}

function ModelFields({
  formId,
  state,
  defaults,
}: {
  formId: string;
  state: FormState;
  defaults?: Record<string, string>;
}) {
  const common = { formId, state, defaults };
  return (
    <>
      <Field {...common} name="name" label="Model ka naam" required />

      <div>
        <label
          htmlFor={`${formId}-product_type`}
          className="mb-1 block text-sm font-medium"
        >
          Type
        </label>
        <select
          id={`${formId}-product_type`}
          name="product_type"
          defaultValue={valueOf(state, defaults, "product_type") || "phone"}
          className={inputClass}
        >
          {Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Field {...common} name="series" label="Series (optional)" />
      <Field
        {...common}
        name="release_year"
        label="Launch ka saal (optional)"
        inputMode="numeric"
      />
      <Field {...common} name="display_info" label="Display (optional)" />
      <Field {...common} name="chipset" label="Chipset (optional)" />
      <Field {...common} name="camera_info" label="Camera (optional)" />
      <Field {...common} name="battery_info" label="Battery (optional)" />
      <Field {...common} name="os_info" label="Operating system (optional)" />
      <Field
        {...common}
        name="spec_source"
        label="Source link"
        inputMode="url"
        placeholder="https://..."
        hint="Specs jis official page se dekhi hain uska link."
      />

      <div className="sm:col-span-2">
        <label
          htmlFor={`${formId}-description`}
          className="mb-1 block text-sm font-medium"
        >
          Description (optional)
        </label>
        <textarea
          id={`${formId}-description`}
          name="description"
          rows={3}
          defaultValue={valueOf(state, defaults, "description")}
          className={inputClass}
        />
      </div>

      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
        Specs sirf official website ya manufacturer ke page se dekh kar likhein,
        andaza na lagayein. Jo maloom na ho wo khali chhor dein.
      </p>
    </>
  );
}

export function AddBrandForm() {
  const [state, action, pending] = useActionState(addBrand, initialState);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field
            formId="brand"
            name="name"
            label="Naye brand ka naam"
            state={state}
            required
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          Brand add karein
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function NewModelForm({
  brands,
}: {
  brands: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createModel, initialState);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="new-brand_id"
            className="mb-1 block text-sm font-medium"
          >
            Brand
          </label>
          <select
            id="new-brand_id"
            name="brand_id"
            required
            defaultValue={state.values?.brand_id ?? ""}
            className={inputClass}
          >
            <option value="">Brand chunein</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </div>
        <ModelFields formId="new" state={state} />
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Ban raha hai..." : "Model banayein"}
      </button>
    </form>
  );
}

export type ModelForEdit = {
  id: string;
  name: string;
  product_type: string;
  series: string | null;
  release_year: number | null;
  display_info: string | null;
  chipset: string | null;
  camera_info: string | null;
  battery_info: string | null;
  os_info: string | null;
  description: string | null;
  spec_source: string | null;
};

export function EditModelForm({ model }: { model: ModelForEdit }) {
  const [state, action, pending] = useActionState(updateModel, initialState);
  const defaults: Record<string, string> = {
    name: model.name,
    product_type: model.product_type,
    series: model.series ?? "",
    release_year: model.release_year?.toString() ?? "",
    display_info: model.display_info ?? "",
    chipset: model.chipset ?? "",
    camera_info: model.camera_info ?? "",
    battery_info: model.battery_info ?? "",
    os_info: model.os_info ?? "",
    description: model.description ?? "",
    spec_source: model.spec_source ?? "",
  };
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="model_id" value={model.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <ModelFields formId="edit" state={state} defaults={defaults} />
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Save ho raha hai..." : "Save karein"}
      </button>
    </form>
  );
}

export function AddVariantForm({ modelId }: { modelId: string }) {
  const [state, action, pending] = useActionState(addVariant, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="model_id" value={modelId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28">
          <Field
            formId="variant"
            name="storage"
            label="Storage"
            state={state}
            inputMode="numeric"
            required
          />
        </div>
        <div className="w-24">
          <label
            htmlFor="variant-storage_unit"
            className="mb-1 block text-sm font-medium"
          >
            Unit
          </label>
          <select
            id="variant-storage_unit"
            name="storage_unit"
            defaultValue={state.values?.storage_unit ?? "GB"}
            className={inputClass}
          >
            <option value="GB">GB</option>
            <option value="TB">TB</option>
          </select>
        </div>
        <div className="w-36">
          <Field
            formId="variant"
            name="ram"
            label="RAM (GB, optional)"
            state={state}
            inputMode="numeric"
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          Variant add karein
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function AddColorForm({ modelId }: { modelId: string }) {
  const [state, action, pending] = useActionState(addColor, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="model_id" value={modelId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field
            formId="color"
            name="name"
            label="Color ka naam"
            state={state}
            required
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          Color add karein
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function ActiveToggle({
  kind,
  id,
  active,
}: {
  kind: "model" | "variant" | "color";
  id: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(setActive, initialState);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-60 dark:text-blue-400"
      >
        {active ? "Band karein" : "Chalu karein"}
      </button>
      {state.error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}