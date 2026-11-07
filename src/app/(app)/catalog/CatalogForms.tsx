"use client";

import { useActionState } from "react";
import { Info } from "lucide-react";
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
import {
  Notice,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/components/ui";

const initialState: FormState = { error: null, success: null };

const buttonClass = primaryButtonClass;

function Message({ state }: { state: FormState }) {
  if (state.error) return <Notice kind="error">{state.error}</Notice>;
  if (state.success) return <Notice kind="success">{state.success}</Notice>;
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
      <label htmlFor={id} className={labelClass}>
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
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
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
      <Field {...common} name="name" label="Model name" required />

      <div>
        <label htmlFor={`${formId}-product_type`} className={labelClass}>
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
        label="Release year (optional)"
        inputMode="numeric"
        placeholder="e.g. 2024"
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
        hint="Link to the official page the specifications were taken from."
      />

      <div className="sm:col-span-2">
        <label htmlFor={`${formId}-description`} className={labelClass}>
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

      <p className="flex items-start gap-2 rounded-2xl bg-amber/15 px-4 py-3 text-xs text-ink sm:col-span-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        Only enter specifications from the official website or the
        manufacturer&apos;s page. Do not guess; leave unknown fields empty.
      </p>
    </>
  );
}

export function AddBrandForm() {
  const [state, action, pending] = useActionState(addBrand, initialState);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            formId="brand"
            name="name"
            label="Brand name"
            state={state}
            required
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Adding..." : "Add brand"}
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
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="new-brand_id" className={labelClass}>
            Brand
          </label>
          <select
            id="new-brand_id"
            name="brand_id"
            required
            defaultValue={state.values?.brand_id ?? ""}
            className={inputClass}
          >
            <option value="">Choose a brand</option>
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
      <button
        type="submit"
        disabled={pending}
        className={buttonClass + " w-full sm:w-auto"}
      >
        {pending ? "Creating..." : "Create model"}
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
    <form action={action} className="space-y-5">
      <input type="hidden" name="model_id" value={model.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <ModelFields formId="edit" state={state} defaults={defaults} />
      </div>
      <Message state={state} />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass + " w-full sm:w-auto"}
      >
        {pending ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}

export function AddVariantForm({ modelId }: { modelId: string }) {
  const [state, action, pending] = useActionState(addVariant, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="model_id" value={modelId} />
      <p className="text-sm font-semibold text-ink">Add a variant</p>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
        <div className="sm:w-32">
          <Field
            formId="variant"
            name="storage"
            label="Storage"
            state={state}
            inputMode="numeric"
            placeholder="128"
            required
          />
        </div>
        <div className="sm:w-28">
          <label htmlFor="variant-storage_unit" className={labelClass}>
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
        <div className="col-span-2 sm:w-40">
          <Field
            formId="variant"
            name="ram"
            label="RAM (GB, optional)"
            state={state}
            inputMode="numeric"
            placeholder="8"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass + " col-span-2"}
        >
          {pending ? "Adding..." : "Add variant"}
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            formId="color"
            name="name"
            label="Add a color"
            state={state}
            placeholder="e.g. Midnight Black"
            required
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Adding..." : "Add color"}
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
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-xs font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-60"
      >
        {active ? "Deactivate" : "Activate"}
      </button>
      {state.error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
