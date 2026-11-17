"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { ACCOUNT_KINDS, type AccountKind } from "@/lib/finance";
import { createAccount, updateAccount } from "@/app/(app)/finance/actions";

const SIGNED_MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;

function validOpening(value: string) {
  const clean = value.replace(/,/g, "").trim();
  return clean === "" || SIGNED_MONEY.test(clean);
}

export function NewAccountForm({ today, currency }: { today: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("wallet");
  const [details, setDetails] = useState("");
  const [opening, setOpening] = useState("");
  const [openingDate, setOpeningDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(null);
    if (!name.trim()) return setError("Enter a name for the account.");
    if (!validOpening(opening)) return setError("The opening balance must be a number with up to 2 decimals.");
    startTransition(async () => {
      try {
        const result = await createAccount({
          name: name.trim(),
          kind,
          details: details.trim(),
          opening_balance: opening.replace(/,/g, "").trim(),
          opening_date: openingDate,
        });
        if (result.ok) {
          setSuccess(result.message ?? "Account added.");
          setName("");
          setDetails("");
          setOpening("");
          setOpen(false);
          router.refresh();
        } else {
          setError(result.error ?? "The account could not be saved.");
        }
      } catch {
        setError("The account could not be saved. Please check your connection and try again.");
      }
    });
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setOpen(true)} className={primaryButtonClass}>
          <Plus className="h-4 w-4" />
          Add account
        </button>
        {success && <Notice kind="success">{success}</Notice>}
      </div>
    );
  }

  return (
    <section className={cardClass} aria-labelledby="new-account-title">
      <h2 id="new-account-title" className="mb-4 text-base font-bold text-ink">
        New account
      </h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="acc-name" className={labelClass}>
              Name
            </label>
            <input
              id="acc-name"
              type="text"
              maxLength={60}
              required
              autoFocus
              placeholder="e.g. JazzCash"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acc-kind" className={labelClass}>
              Kind
            </label>
            <select
              id="acc-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as AccountKind)}
              className={inputClass}
            >
              {ACCOUNT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label} – {k.hint}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="acc-details" className={labelClass}>
              Details (optional)
            </label>
            <input
              id="acc-details"
              type="text"
              maxLength={200}
              placeholder="e.g. bank and branch, or the last 4 digits"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="acc-opening" className={labelClass}>
              Opening balance ({currency})
            </label>
            <input
              id="acc-opening"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink-muted">The money in this account on the opening date.</p>
          </div>
          <div>
            <label htmlFor="acc-opening-date" className={labelClass}>
              Opening date
            </label>
            <input
              id="acc-opening-date"
              type="date"
              max={today}
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Saving..." : "Add account"}
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={pending} className={secondaryButtonClass}>
            Close
          </button>
        </div>
      </form>
    </section>
  );
}

export function AccountActions({
  account,
  today,
  currency,
}: {
  account: {
    id: string;
    name: string;
    kind: AccountKind;
    details: string | null;
    opening_balance: string;
    opening_date: string;
    is_default: boolean;
    is_active: boolean;
  };
  today: string;
  currency: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [details, setDetails] = useState(account.details ?? "");
  const [opening, setOpening] = useState(account.opening_balance);
  const [openingDate, setOpeningDate] = useState(account.opening_date);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(payload: Record<string, unknown>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateAccount({ account_id: account.id, ...payload });
        if (result.ok) {
          after?.();
          router.refresh();
        } else {
          setError(result.error ?? "The account could not be saved.");
        }
      } catch {
        setError("The account could not be saved. Please check your connection and try again.");
      }
    });
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!name.trim()) return setError("Enter a name for the account.");
    if (!validOpening(opening)) return setError("The opening balance must be a number with up to 2 decimals.");
    run(
      {
        name: name.trim(),
        details: details.trim(),
        opening_balance: opening.replace(/,/g, "").trim() || "0",
        opening_date: openingDate,
      },
      () => setEditing(false)
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          disabled={pending}
          className={secondaryButtonClass}
        >
          <Pencil className="h-4 w-4" />
          {editing ? "Close" : "Edit"}
        </button>
        {account.is_active && !account.is_default && account.kind !== "wallet" && (
          <button type="button" disabled={pending} onClick={() => run({ make_default: true })} className={secondaryButtonClass}>
            Make default {account.kind}
          </button>
        )}
        {!account.is_default && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run({ is_active: !account.is_active })}
            className={secondaryButtonClass}
          >
            {account.is_active ? "Deactivate" : "Activate"}
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={onSave} className="grid gap-3 rounded-2xl bg-surface-muted p-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`name-${account.id}`} className={labelClass}>
              Name
            </label>
            <input
              id={`name-${account.id}`}
              type="text"
              maxLength={60}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`details-${account.id}`} className={labelClass}>
              Details
            </label>
            <input
              id={`details-${account.id}`}
              type="text"
              maxLength={200}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`opening-${account.id}`} className={labelClass}>
              Opening balance ({currency})
            </label>
            <input
              id={`opening-${account.id}`}
              type="text"
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`opening-date-${account.id}`} className={labelClass}>
              Opening date
            </label>
            <input
              id={`opening-date-${account.id}`}
              type="date"
              max={today}
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <p className="text-xs text-ink-muted sm:col-span-2">
            Changing the opening balance adds an opening balance entry for the difference, so the ledger always
            explains the balance.
          </p>
          <div className="sm:col-span-2">
            <button type="submit" disabled={pending} className={primaryButtonClass}>
              {pending ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
