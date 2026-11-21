"use client";

import Link from "next/link";
import { useActionState } from "react";
import { phonePlaceholder, type Region } from "@/lib/region";
import { UserPlus } from "lucide-react";
import {
  createCustomer,
  setCustomerActive,
  updateCustomer,
  type CustomerFormState,
} from "@/app/(app)/customers/actions";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";

const initialState: CustomerFormState = { error: null, success: null };

type Defaults = { name: string; phone: string; address: string; notes: string; trn: string };

function CustomerFields({
  prefix,
  defaults,
  region,
}: {
  prefix: string;
  defaults: Partial<Defaults>;
  region: Region;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${prefix}-name`} className={labelClass}>
          Name
        </label>
        <input
          id={`${prefix}-name`}
          name="name"
          type="text"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={defaults.name ?? ""}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-phone`} className={labelClass}>
          Phone
        </label>
        <input
          id={`${prefix}-phone`}
          name="phone"
          type="tel"
          required
          maxLength={40}
          autoComplete="off"
          placeholder={phonePlaceholder(region)}
          defaultValue={defaults.phone ?? ""}
          className={inputClass}
        />
      </div>
      {region === "PK" ? (
        // Pakistan has no VAT: keep any saved TRN unchanged
        <input type="hidden" name="trn" value={defaults.trn ?? ""} />
      ) : (
      <div>
        <label htmlFor={`${prefix}-trn`} className={labelClass}>
          TRN (optional)
        </label>
        <input
          id={`${prefix}-trn`}
          name="trn"
          type="text"
          inputMode="numeric"
          maxLength={20}
          autoComplete="off"
          placeholder="15 digits, for VAT-registered customers"
          defaultValue={defaults.trn ?? ""}
          className={inputClass}
        />
      </div>
      )}
      <div>
        <label htmlFor={`${prefix}-address`} className={labelClass}>
          Address (optional)
        </label>
        <textarea
          id={`${prefix}-address`}
          name="address"
          rows={2}
          maxLength={300}
          defaultValue={defaults.address ?? ""}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-notes`} className={labelClass}>
          Notes (optional)
        </label>
        <textarea
          id={`${prefix}-notes`}
          name="notes"
          rows={2}
          maxLength={1000}
          defaultValue={defaults.notes ?? ""}
          className={inputClass}
        />
      </div>
    </div>
  );
}

export function AddCustomerForm({ region }: { region: Region }) {
  const [state, action, pending] = useActionState(createCustomer, initialState);
  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-mint text-ink">
          <UserPlus className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">Add customer</h2>
          <p className="text-xs text-ink-muted">Each phone number can be used for one customer only.</p>
        </div>
      </div>
      <form action={action} className="space-y-4">
        <CustomerFields prefix="add-customer" defaults={state.values ?? {}} region={region} />
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.success && <Notice kind="success">{state.success}</Notice>}
        <button type="submit" disabled={pending} className={primaryButtonClass + " w-full sm:w-auto"}>
          {pending ? "Saving..." : "Add customer"}
        </button>
      </form>
    </section>
  );
}

export function EditCustomerForm({
  customer,
  cancelHref,
  region,
}: {
  customer: { id: string } & Defaults;
  cancelHref: string;
  region: Region;
}) {
  const [state, action, pending] = useActionState(updateCustomer, initialState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="customer_id" value={customer.id} />
      <CustomerFields prefix="edit-customer" defaults={state.values ?? customer} region={region} />
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.success && <Notice kind="success">{state.success}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving..." : "Save changes"}
        </button>
        <Link href={cancelHref} className={secondaryButtonClass}>
          Close
        </Link>
      </div>
    </form>
  );
}

export function CustomerActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setCustomerActive, initialState);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="customer_id" value={id} />
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
