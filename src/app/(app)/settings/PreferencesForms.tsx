"use client";

import { useActionState, useState } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import {
  addExpenseCategory,
  removeLogo,
  updateExpenseCategory,
  updateInvoiceSettings,
  updateProductCategory,
  updateStockSettings,
  uploadLogo,
  type PreferencesState,
} from "@/app/(app)/settings/preferences-actions";
import {
  Notice,
  StatusPill,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { DATE_FORMAT_OPTIONS } from "@/lib/format";

const initial: PreferencesState = { error: null, success: null };

function Messages({ state }: { state: PreferencesState }) {
  if (state.error) return <Notice kind="error">{state.error}</Notice>;
  if (state.success) return <Notice kind="success">{state.success}</Notice>;
  return null;
}

function Toggle({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-line px-4 text-sm text-ink">
      <input
        key={String(defaultChecked)}
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-5 w-5 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

// ---------- Logo ----------

export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const [state, action, pending] = useActionState(uploadLogo, initial);
  const [removeState, removeAction, removing] = useActionState(removeLogo, initial);
  const [fileName, setFileName] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-white">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the logo lives in Supabase Storage
            <img src={logoUrl} alt="Shop logo" className="h-full w-full object-contain" />
          ) : (
            <ImageIcon className="h-7 w-7 text-ink-muted" />
          )}
        </div>
        <form action={action} className="flex flex-wrap items-center gap-2">
          <label className={secondaryButtonClass + " cursor-pointer"}>
            <Upload className="h-4 w-4" />
            {fileName ? "Change file" : "Choose image"}
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            />
          </label>
          <button type="submit" disabled={pending || !fileName} className={primaryButtonClass}>
            {pending ? "Uploading..." : "Upload logo"}
          </button>
          {fileName && <span className="text-xs text-ink-muted">{fileName}</span>}
        </form>
        {logoUrl && (
          <form action={removeAction}>
            <button type="submit" disabled={removing} className={secondaryButtonClass}>
              <Trash2 className="h-4 w-4" />
              {removing ? "Removing..." : "Remove"}
            </button>
          </form>
        )}
      </div>
      <p className="text-xs text-ink-muted">PNG, JPEG or WebP, up to 512 KB. A square image looks best.</p>
      <Messages state={state} />
      <Messages state={removeState} />
    </div>
  );
}

// ---------- Invoice and receipt ----------

export function InvoiceSettingsForm({
  defaults,
}: {
  defaults: {
    invoice_paper: string;
    date_format: string;
    invoice_footer: string;
    warranty_terms: string;
    invoice_show_logo: boolean;
    invoice_show_customer_phone: boolean;
    invoice_show_warranty: boolean;
    invoice_show_payment_method: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateInvoiceSettings, initial);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invoice-paper" className={labelClass}>
            Default paper size
          </label>
          {/* key: React applies a select's defaultValue only on mount, and the form
              is reset after saving, so remount it when the saved value changes */}
          <select
            key={defaults.invoice_paper}
            id="invoice-paper"
            name="invoice_paper"
            defaultValue={defaults.invoice_paper}
            className={inputClass}
          >
            <option value="a4">A4</option>
            <option value="thermal">Thermal 80 mm</option>
          </select>
          <p className="mt-1 text-xs text-ink-muted">Used until a person picks another size on the invoice.</p>
        </div>
        <div>
          <label htmlFor="date-format" className={labelClass}>
            Date format on invoices
          </label>
          <select
            key={defaults.date_format}
            id="date-format"
            name="date_format"
            defaultValue={defaults.date_format}
            className={inputClass}
          >
            {DATE_FORMAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle name="invoice_show_logo" label="Show the logo" defaultChecked={defaults.invoice_show_logo} />
        <Toggle
          name="invoice_show_customer_phone"
          label="Show the customer phone"
          defaultChecked={defaults.invoice_show_customer_phone}
        />
        <Toggle name="invoice_show_warranty" label="Show the warranty column" defaultChecked={defaults.invoice_show_warranty} />
        <Toggle
          name="invoice_show_payment_method"
          label="Show the payment method"
          defaultChecked={defaults.invoice_show_payment_method}
        />
      </div>
      <div>
        <label htmlFor="warranty-terms" className={labelClass}>
          Warranty terms
        </label>
        <textarea
          id="warranty-terms"
          name="warranty_terms"
          rows={3}
          maxLength={1000}
          defaultValue={defaults.warranty_terms}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-ink-muted">Copied onto each new invoice when it is saved.</p>
      </div>
      <div>
        <label htmlFor="invoice-footer" className={labelClass}>
          Invoice footer
        </label>
        <textarea
          id="invoice-footer"
          name="invoice_footer"
          rows={2}
          maxLength={500}
          placeholder="For example: Thank you for your purchase."
          defaultValue={defaults.invoice_footer}
          className={inputClass}
        />
      </div>
      <Messages state={state} />
      <button type="submit" disabled={pending} className={primaryButtonClass + " w-full sm:w-auto"}>
        {pending ? "Saving..." : "Save invoice settings"}
      </button>
    </form>
  );
}

// ---------- Stock ----------

export function StockSettingsForm({ threshold }: { threshold: number }) {
  const [state, action, pending] = useActionState(updateStockSettings, initial);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-56">
          <label htmlFor="low-stock" className={labelClass}>
            Low stock threshold
          </label>
          <input
            id="low-stock"
            name="low_stock_threshold"
            type="text"
            inputMode="numeric"
            defaultValue={String(threshold)}
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        An accessory counts as low stock when its quantity is at or below this number.
      </p>
      <Messages state={state} />
    </form>
  );
}

// ---------- Category lists (expense and product) ----------

type Category = { id: string; name: string; is_active: boolean };

function CategoryRow({
  category,
  action,
}: {
  category: Category;
  action: (prev: PreferencesState, formData: FormData) => Promise<PreferencesState>;
}) {
  const [renameState, renameAction, renaming] = useActionState(action, initial);
  const [toggleState, toggleAction, toggling] = useActionState(action, initial);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form action={renameAction} className="flex flex-1 gap-2">
          <input type="hidden" name="id" value={category.id} />
          <input
            name="name"
            type="text"
            maxLength={60}
            required
            defaultValue={category.name}
            aria-label={`Name of ${category.name}`}
            className={inputClass}
          />
          <button type="submit" disabled={renaming} className={secondaryButtonClass}>
            Save
          </button>
        </form>
        <div className="flex items-center gap-2">
          <StatusPill active={category.is_active} />
          <form action={toggleAction}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="active" value={category.is_active ? "false" : "true"} />
            <button type="submit" disabled={toggling} className={secondaryButtonClass}>
              {category.is_active ? "Deactivate" : "Activate"}
            </button>
          </form>
        </div>
      </div>
      <Messages state={renameState} />
      <Messages state={toggleState} />
    </li>
  );
}

export function ExpenseCategoriesManager({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState(addExpenseCategory, initial);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="new-expense-category" className={labelClass}>
            New category
          </label>
          <input
            id="new-expense-category"
            name="name"
            type="text"
            maxLength={60}
            required
            placeholder="For example: Rent"
            className={inputClass}
          />
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Adding..." : "Add category"}
        </button>
      </form>
      <div aria-live="polite">
        <Messages state={state} />
      </div>
      {categories.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
          No categories yet. The expense form suggests common ones until you add your own.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {categories.map((c) => (
            <CategoryRow key={`${c.id}-${c.name}-${c.is_active}`} category={c} action={updateExpenseCategory} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProductCategoriesManager({ categories }: { categories: Category[] }) {
  if (categories.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
        No product categories yet. They are created when accessories are added to the catalog.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {categories.map((c) => (
        <CategoryRow key={`${c.id}-${c.name}-${c.is_active}`} category={c} action={updateProductCategory} />
      ))}
    </ul>
  );
}
