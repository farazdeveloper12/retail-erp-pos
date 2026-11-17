"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Calculator, X } from "lucide-react";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { cleanMoneyInput, formatMoney, isValidMoneyInput, toCents } from "@/lib/money";
import { MANUAL_TYPES, type ManualType } from "@/lib/finance";
import { cancelEntry, recordCount, recordEntry } from "@/app/(app)/finance/actions";

export type AccountOption = { id: string; name: string; kind: string; balance: string };

function AccountSelect({
  id,
  value,
  onChange,
  accounts,
  exclude,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  accounts: AccountOption[];
  exclude?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {accounts
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}

// ---------- Manual entry ----------

export function EntryForm({
  accounts,
  today,
  currency,
}: {
  accounts: AccountOption[];
  today: string;
  currency: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<ManualType>("transfer");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? "");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const info = MANUAL_TYPES.find((t) => t.value === type);
  const account = accounts.find((a) => a.id === accountId);
  const amountCents = isValidMoneyInput(amount) ? toCents(amount) : null;
  const goesOut =
    type === "withdrawal" || type === "owner_capital_out" || type === "transfer" ||
    (type === "adjustment" && direction === "out");
  const balanceCents = account ? toCents(account.balance) : null;
  const short =
    goesOut && type !== "adjustment" && amountCents !== null && balanceCents !== null && amountCents > balanceCents;

  function onTypeChange(next: ManualType) {
    setType(next);
    setError(null);
    if (next === "transfer" && (toAccountId === accountId || !toAccountId)) {
      setToAccountId(accounts.find((a) => a.id !== accountId)?.id ?? "");
    }
  }

  function onAccountChange(next: string) {
    setAccountId(next);
    if (next === toAccountId) setToAccountId(accounts.find((a) => a.id !== next)?.id ?? "");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(null);
    if (amountCents === null || amountCents <= BigInt(0)) {
      setError("Enter an amount above zero with up to 2 decimals.");
      return;
    }
    if (type === "adjustment" && !notes.trim()) {
      setError("Write a short note that explains the adjustment.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await recordEntry({
          type,
          account_id: accountId,
          to_account_id: type === "transfer" ? toAccountId : undefined,
          direction: type === "adjustment" ? direction : undefined,
          amount: cleanMoneyInput(amount),
          entry_date: date,
          notes: notes.trim(),
        });
        if (result.ok) {
          setSuccess(`Saved: ${info?.label ?? "Entry"} of ${formatMoney(amountCents, currency)}.`);
          setAmount("");
          setNotes("");
          router.refresh();
        } else {
          setError(result.error ?? "The entry could not be saved.");
        }
      } catch {
        setError("The entry could not be saved. Please check your connection and try again.");
      }
    });
  }

  if (accounts.length === 0) {
    return <Notice kind="error">Add an active account first.</Notice>;
  }

  return (
    <section className={cardClass} aria-labelledby="entry-title">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-pill text-pill-ink">
          <ArrowLeftRight className="h-5 w-5" />
        </span>
        <div>
          <h2 id="entry-title" className="text-base font-bold text-ink">
            New entry
          </h2>
          <p className="text-xs text-ink-muted">{info?.hint}</p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of entry">
          {MANUAL_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={type === t.value}
              onClick={() => onTypeChange(t.value)}
              className={
                "min-h-11 rounded-full border px-4 text-sm font-semibold transition " +
                (type === t.value
                  ? "border-transparent bg-pill text-pill-ink"
                  : "border-line bg-surface text-ink-muted hover:text-ink")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="entry-account" className={labelClass}>
              {type === "transfer" ? "From account" : "Account"}
            </label>
            <AccountSelect id="entry-account" value={accountId} onChange={onAccountChange} accounts={accounts} />
            {account && (
              <p className="mt-1 text-xs text-ink-muted">Balance: {formatMoney(account.balance, currency)}</p>
            )}
          </div>

          {type === "transfer" && (
            <div>
              <label htmlFor="entry-to-account" className={labelClass}>
                To account
              </label>
              {accounts.length < 2 ? (
                <p className="text-sm text-ink-muted">Add a second account to make transfers.</p>
              ) : (
                <AccountSelect
                  id="entry-to-account"
                  value={toAccountId}
                  onChange={setToAccountId}
                  accounts={accounts}
                  exclude={accountId}
                />
              )}
            </div>
          )}

          {type === "adjustment" && (
            <div>
              <label htmlFor="entry-direction" className={labelClass}>
                Adjustment
              </label>
              <select
                id="entry-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "in" | "out")}
                className={inputClass}
              >
                <option value="in">Add money (+)</option>
                <option value="out">Remove money (−)</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor="entry-amount" className={labelClass}>
              Amount ({currency})
            </label>
            <input
              id="entry-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="entry-date" className={labelClass}>
              Date
            </label>
            <input
              id="entry-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="entry-notes" className={labelClass}>
            Note {type === "adjustment" ? "(required)" : "(optional)"}
          </label>
          <input
            id="entry-notes"
            type="text"
            maxLength={500}
            autoComplete="off"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </div>

        {short && (
          <Notice kind="error">
            {account?.name} has only {formatMoney(account?.balance, currency)}. The entry will be refused.
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}

        <button
          type="submit"
          disabled={pending || (type === "transfer" && accounts.length < 2)}
          className={primaryButtonClass + " w-full sm:w-auto"}
        >
          {pending ? "Saving..." : "Save entry"}
        </button>
      </form>
    </section>
  );
}

// ---------- Cash count ----------

export function CountForm({ accounts, currency }: { accounts: AccountOption[]; currency: string }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts.find((a) => a.kind === "cash")?.id ?? accounts[0]?.id ?? "");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [post, setPost] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const account = accounts.find((a) => a.id === accountId);
  const countedCents = isValidMoneyInput(counted) ? toCents(counted) : null;
  const balanceCents = account ? toCents(account.balance) : null;
  const diff = countedCents !== null && balanceCents !== null ? countedCents - balanceCents : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSuccess(null);
    if (countedCents === null) {
      setError("The counted amount must be 0 or more with up to 2 decimals.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await recordCount({
          account_id: accountId,
          counted_amount: cleanMoneyInput(counted),
          notes: notes.trim(),
          post_adjustment: post,
        });
        if (result.ok) {
          setSuccess("Count saved.");
          setCounted("");
          setNotes("");
          router.refresh();
        } else {
          setError(result.error ?? "The count could not be saved.");
        }
      } catch {
        setError("The count could not be saved. Please check your connection and try again.");
      }
    });
  }

  if (accounts.length === 0) return null;

  return (
    <section className={cardClass} aria-labelledby="count-title">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-aqua text-accent">
          <Calculator className="h-5 w-5" />
        </span>
        <div>
          <h2 id="count-title" className="text-base font-bold text-ink">
            Count cash
          </h2>
          <p className="text-xs text-ink-muted">Compare the money you counted with the balance in the app.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="count-account" className={labelClass}>
              Account
            </label>
            <AccountSelect id="count-account" value={accountId} onChange={setAccountId} accounts={accounts} />
          </div>
          <div>
            <label htmlFor="count-amount" className={labelClass}>
              Counted amount ({currency})
            </label>
            <input
              id="count-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-muted px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-ink-muted">Balance in the app</dt>
            <dd className="font-semibold text-ink">{formatMoney(account?.balance, currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Difference</dt>
            <dd
              className={
                "font-semibold " +
                (diff === null || diff === BigInt(0) ? "text-ink" : diff > BigInt(0) ? "text-accent" : "text-danger")
              }
            >
              {diff === null
                ? "—"
                : diff === BigInt(0)
                  ? "Matches"
                  : `${diff > BigInt(0) ? "+" : ""}${formatMoney(diff, currency)} (${diff > BigInt(0) ? "extra" : "short"})`}
            </dd>
          </div>
        </dl>

        <div>
          <label htmlFor="count-notes" className={labelClass}>
            Note (optional)
          </label>
          <input
            id="count-notes"
            type="text"
            maxLength={500}
            autoComplete="off"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={post}
            onChange={(e) => setPost(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[var(--accent)]"
          />
          <span>
            Post the difference as an adjustment
            <span className="block text-xs text-ink-muted">
              The balance in the app then matches the counted amount. Leave it off to only record the count.
            </span>
          </span>
        </label>

        {error && <Notice kind="error">{error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}

        <button type="submit" disabled={pending} className={secondaryButtonClass + " w-full sm:w-auto"}>
          {pending ? "Saving..." : "Save count"}
        </button>
      </form>
    </section>
  );
}

// ---------- Cancel a manual entry ----------

export function CancelEntryButton({ entryId, isTransfer }: { entryId: string; isTransfer: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelEntry({ entry_id: entryId, reason: reason.trim() });
        if (result.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result.error ?? "The entry could not be cancelled.");
        }
      } catch {
        setError("The entry could not be cancelled. Please check your connection and try again.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-danger hover:bg-danger-soft"
      >
        <X className="h-3.5 w-3.5" />
        Cancel
      </button>
    );
  }

  return (
    <div className="w-full min-w-56 space-y-2 rounded-2xl border border-line bg-surface p-3 text-left">
      <p className="text-xs text-ink-muted">
        {isTransfer
          ? "Both sides of the transfer get a reversing entry dated today."
          : "A reversing entry dated today is added. Nothing is deleted."}
      </p>
      <input
        type="text"
        maxLength={300}
        placeholder="Reason (optional)"
        aria-label="Reason for cancelling"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className={inputClass}
      />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-full bg-coral px-4 text-xs font-semibold text-pill-ink disabled:opacity-60"
        >
          {pending ? "Cancelling..." : "Cancel entry"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-xs font-semibold text-ink"
        >
          Keep
        </button>
      </div>
    </div>
  );
}
