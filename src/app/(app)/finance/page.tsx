import type { Metadata } from "next";
import Link from "next/link";
import { Download, Landmark, Search, Settings2, Smartphone, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  EmptyState,
  Notice,
  PageHeader,
  Pill,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney, toCents } from "@/lib/money";
import { formatDateWith, type DateFormat } from "@/lib/format";
import { todayInKarachi } from "@/lib/dashboard";
import {
  CATEGORY_LABELS,
  accountKindLabel,
  canCancelEntry,
  categoryLabel,
  entryDescription,
  entrySourceHref,
  fetchAccounts,
  fetchLedger,
  filtersToSearch,
  parseLedgerFilters,
  type FinanceAccount,
} from "@/lib/finance";
import { CancelEntryButton, CountForm, EntryForm } from "@/app/(app)/finance/FinanceForms";

export const metadata: Metadata = {
  title: "Cash & Bank",
};

const PAGE_SIZE = 50;

const KIND_ICONS: Record<string, LucideIcon> = { cash: Wallet, bank: Landmark, wallet: Smartphone };
const KIND_TONES: Record<string, string> = { cash: "bg-mint", bank: "bg-aqua", wallet: "bg-lavender" };

type Summary = {
  opening: unknown;
  total_in: unknown;
  total_out: unknown;
  periods: { period: string; total_in: unknown; total_out: unknown; net: unknown; entries: number }[];
};

type CountRow = {
  id: string;
  count_date: string;
  created_at: string;
  account_id: string;
  counted_amount: number | string;
  system_balance: number | string;
  difference: number | string;
  notes: string | null;
  adjustment_id: string | null;
};

function periodLabel(period: string, group: "day" | "month", dateFormat: DateFormat) {
  if (group === "day") return formatDateWith(period, dateFormat);
  const [year, month] = period.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

function AccountCard({
  account,
  currency,
  href,
  selected,
}: {
  account: FinanceAccount;
  currency: string;
  href: string;
  selected: boolean;
}) {
  const Icon = KIND_ICONS[account.kind] ?? Wallet;
  const negative = (toCents(account.balance) ?? BigInt(0)) < BigInt(0);
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={
        "block rounded-card border px-5 py-4 shadow-soft transition hover:-translate-y-0.5 " +
        (selected ? "border-accent ring-4 ring-accent/15 " : "border-line ") +
        (KIND_TONES[account.kind] ?? "bg-surface")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-surface text-accent">
          <Icon className="h-4 w-4" />
        </span>
        {account.is_default && <Pill tone="neutral">Default</Pill>}
      </div>
      <p className="mt-3 truncate text-sm font-semibold text-ink">{account.name}</p>
      <p className="text-xs text-ink-muted">{accountKindLabel(account.kind)}</p>
      <p className={"mt-1 text-xl font-bold " + (negative ? "text-danger" : "text-ink")}>
        {formatMoney(account.balance, currency)}
      </p>
    </Link>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "finance")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("finance.manage");

  const params = await searchParams;
  const filters = parseLedgerFilters(params);
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const today = todayInKarachi();

  const supabase = await createClient();
  const [business, { accounts, error: accountsError }, ledger, summaryResult, { data: countData }] =
    await Promise.all([
      getMyBusiness(),
      fetchAccounts(supabase),
      fetchLedger(supabase, filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
      supabase.rpc("get_finance_summary", {
        p_from: filters.from,
        p_to: filters.to,
        p_account_id: filters.account,
        p_group: filters.group,
      }),
      supabase
        .from("finance_counts")
        .select("id, count_date, created_at, account_id, counted_amount, system_balance, difference, notes, adjustment_id")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const currency = business?.currency_code || "PKR";
  const dateFormat = (business?.date_format ?? "medium") as DateFormat;
  const summary = (summaryResult.data ?? null) as Summary | null;
  const counts = (countData ?? []) as CountRow[];
  const activeAccounts = accounts.filter((a) => a.is_active);
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const selected = filters.account ? accounts.find((a) => a.id === filters.account) : null;

  let total = BigInt(0);
  for (const a of activeAccounts) total += toCents(a.balance) ?? BigInt(0);

  const opening = toCents(summary?.opening) ?? BigInt(0);
  const totalIn = toCents(summary?.total_in) ?? BigInt(0);
  const totalOut = toCents(summary?.total_out) ?? BigInt(0);
  const closing = opening + totalIn - totalOut;
  const pages = Math.max(1, Math.ceil(ledger.count / PAGE_SIZE));

  const accountHref = (id: string | null) =>
    `/finance?${filtersToSearch({ ...filters, account: id })}`;
  const pageHref = (n: number) => `/finance?${filtersToSearch(filters, { page: String(n) })}`;
  const groupHref = (group: "day" | "month") => `/finance?${filtersToSearch({ ...filters, group })}`;
  const exportHref = `/finance/export?${filtersToSearch(filters)}`;

  const accountOptions = activeAccounts.map((a) => ({
    id: a.id,
    name: `${a.name} (${accountKindLabel(a.kind)})`,
    kind: a.kind,
    balance: String(a.balance),
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Landmark}
        title="Cash & Bank"
        description="Balances of cash, bank and wallet accounts, and every money movement."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/finance/accounts" className={secondaryButtonClass}>
              <Settings2 className="h-4 w-4" />
              Accounts
            </Link>
            {/* A plain link: this is a file download from a route handler, not a page */}
            <a href={exportHref} className={secondaryButtonClass}>
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
        }
      />

      {accountsError && <Notice kind="error">Could not load accounts: {accountsError}</Notice>}
      {filters.error && <Notice kind="error">{filters.error}</Notice>}

      {/* Balances */}
      <section aria-label="Balances" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-ink-muted">Total in all active accounts</p>
            <p className={"text-3xl font-bold " + (total < BigInt(0) ? "text-danger" : "text-ink")}>
              {formatMoney(total, currency)}
            </p>
          </div>
          {selected && (
            <Link
              href={accountHref(null)}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:text-accent-strong"
            >
              Show all accounts
            </Link>
          )}
        </div>
        {activeAccounts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No accounts yet"
            text="Run the database update, then add your cash, bank and wallet accounts."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
            {activeAccounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                currency={currency}
                href={accountHref(a.id === filters.account ? null : a.id)}
                selected={a.id === filters.account}
              />
            ))}
          </div>
        )}
      </section>

      {canManage && activeAccounts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <EntryForm accounts={accountOptions} today={today} currency={currency} />
          <CountForm accounts={accountOptions} currency={currency} />
        </div>
      )}

      {/* Filters */}
      <form method="get" className={cardClass + " grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1.1fr_1.4fr_auto] lg:items-end"}>
        {filters.group === "month" && <input type="hidden" name="group" value="month" />}
        <div>
          <label htmlFor="f-account" className={labelClass}>
            Account
          </label>
          <select id="f-account" name="account" defaultValue={filters.account ?? ""} className={inputClass}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-from" className={labelClass}>
            From
          </label>
          <input id="f-from" name="from" type="date" defaultValue={filters.from} max={today} className={inputClass} />
        </div>
        <div>
          <label htmlFor="f-to" className={labelClass}>
            To
          </label>
          <input id="f-to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
        </div>
        <div>
          <label htmlFor="f-type" className={labelClass}>
            Type
          </label>
          <select id="f-type" name="type" defaultValue={filters.type ?? ""} className={inputClass}>
            <option value="">All types</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-q" className={labelClass}>
            Search note
          </label>
          <input
            id="f-q"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={filters.q}
            placeholder="e.g. rent, JazzCash"
            className={inputClass}
          />
        </div>
        <button type="submit" className={primaryButtonClass}>
          <Search className="h-4 w-4" />
          Show
        </button>
      </form>

      {/* Summary for the period */}
      <section className={cardClass} aria-labelledby="summary-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="summary-title" className="text-base font-bold text-ink">
              {selected ? selected.name : "All accounts"}
            </h2>
            <p className="text-xs text-ink-muted">
              {formatDateWith(filters.from, dateFormat)} – {formatDateWith(filters.to, dateFormat)}
              {!selected && " · transfers between your accounts are not counted as money in or out"}
            </p>
          </div>
          <div className="flex rounded-full border border-line p-1" role="tablist" aria-label="Group by">
            {(["day", "month"] as const).map((g) => (
              <Link
                key={g}
                href={groupHref(g)}
                role="tab"
                aria-selected={filters.group === g}
                className={
                  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold " +
                  (filters.group === g ? "bg-pill text-pill-ink" : "text-ink-muted hover:text-ink")
                }
              >
                {g === "day" ? "By day" : "By month"}
              </Link>
            ))}
          </div>
        </div>

        {summaryResult.error ? (
          <Notice kind="error">Could not load the summary: {summaryResult.error.message}</Notice>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "Opening balance", value: opening, tone: "bg-surface-muted" },
                { label: "Money in", value: totalIn, tone: "bg-mint" },
                { label: "Money out", value: totalOut, tone: "bg-peach" },
                { label: "Closing balance", value: closing, tone: "bg-aqua" },
              ].map((item) => (
                <div key={item.label} className={"rounded-2xl px-4 py-3 " + item.tone}>
                  <dt className="text-xs font-medium text-ink-muted">{item.label}</dt>
                  <dd className="mt-0.5 text-lg font-bold text-ink">{formatMoney(item.value, currency)}</dd>
                </div>
              ))}
            </dl>

            {summary && summary.periods.length > 0 ? (
              <div className="mt-4 max-h-80 overflow-auto rounded-2xl border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-4 py-2">{filters.group === "day" ? "Day" : "Month"}</th>
                      <th className="px-4 py-2 text-right">In</th>
                      <th className="px-4 py-2 text-right">Out</th>
                      <th className="px-4 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.periods.map((p) => {
                      const net = toCents(p.net) ?? BigInt(0);
                      return (
                        <tr key={p.period} className="border-t border-line">
                          <td className="whitespace-nowrap px-4 py-2 text-ink">
                            {periodLabel(String(p.period), filters.group, dateFormat)}
                          </td>
                          <td className="px-4 py-2 text-right text-ink">{formatMoney(p.total_in, currency)}</td>
                          <td className="px-4 py-2 text-right text-ink">{formatMoney(p.total_out, currency)}</td>
                          <td
                            className={
                              "px-4 py-2 text-right font-semibold " + (net < BigInt(0) ? "text-danger" : "text-ink")
                            }
                          >
                            {formatMoney(net, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">No money movements in this period.</p>
            )}
          </>
        )}
      </section>

      {/* Ledger */}
      <section aria-labelledby="ledger-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ledger-title" className="text-lg font-bold text-ink">
            Ledger
          </h2>
          <p className="text-sm text-ink-muted">
            {ledger.count === 0
              ? "No entries"
              : `${ledger.count} ${ledger.count === 1 ? "entry" : "entries"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}
          </p>
        </div>

        {ledger.error ? (
          <Notice kind="error">Could not load the ledger: {ledger.error}</Notice>
        ) : ledger.rows.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No entries found"
            text="Try another date range, account or type. Sales, purchases, payments and expenses appear here automatically."
          />
        ) : (
          <>
            {/* Phones and tablets */}
            <ul className="space-y-3 md:hidden">
              {ledger.rows.map((row) => {
                const href = entrySourceHref(row);
                const cancelled = Boolean(row.voided_at);
                return (
                  <li key={row.id} className={cardClass + (cancelled ? " opacity-60" : "")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">
                          {categoryLabel(row.category)}
                          {cancelled && <span className="ml-2 text-xs font-normal text-ink-muted">(cancelled)</span>}
                        </p>
                        <p className="mt-0.5 text-sm text-ink-muted">{entryDescription(row)}</p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {formatDateWith(row.entry_date, dateFormat)} · {row.account_name}
                        </p>
                        {href && (
                          <Link href={href} className="mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-accent">
                            Open source
                          </Link>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={"text-sm font-bold " + (row.direction === "in" ? "text-accent" : "text-danger")}>
                          {row.direction === "in" ? "+" : "−"}
                          {formatMoney(row.amount, currency)}
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">Bal. {formatMoney(row.running_balance, currency)}</p>
                      </div>
                    </div>
                    {canManage && canCancelEntry(row) && (
                      <div className="mt-2 flex justify-end">
                        <CancelEntryButton entryId={row.id} isTransfer={row.ref_type === "transfer"} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Laptops */}
            <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">In</th>
                    <th className="px-4 py-3 text-right">Out</th>
                    <th className="px-4 py-3 text-right" title="Balance of the account after this entry">
                      Balance
                    </th>
                    {canManage && (
                      <th className="px-4 py-3">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row) => {
                    const href = entrySourceHref(row);
                    const cancelled = Boolean(row.voided_at);
                    return (
                      <tr key={row.id} className={"border-b border-line last:border-0" + (cancelled ? " opacity-60" : "")}>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                          {formatDateWith(row.entry_date, dateFormat)}
                        </td>
                        <td className="px-4 py-3 text-ink">{row.account_name}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink">
                          {categoryLabel(row.category)}
                          {cancelled && <span className="ml-1 text-xs text-ink-muted">(cancelled)</span>}
                        </td>
                        <td className="max-w-xs px-4 py-3 text-ink-muted">
                          <span className="line-clamp-2">{entryDescription(row)}</span>
                          {href && (
                            <Link href={href} className="text-xs font-semibold text-accent hover:text-accent-strong">
                              Open source
                            </Link>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-accent">
                          {row.direction === "in" ? formatMoney(row.amount, currency) : ""}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-danger">
                          {row.direction === "out" ? formatMoney(row.amount, currency) : ""}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-ink">
                          {formatMoney(row.running_balance, currency)}
                        </td>
                        {canManage && (
                          <td className="px-2 py-2">
                            {canCancelEntry(row) && (
                              <CancelEntryButton entryId={row.id} isTransfer={row.ref_type === "transfer"} />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <nav aria-label="Ledger pages" className="flex items-center justify-between gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className={secondaryButtonClass}>
                    Newer
                  </Link>
                ) : (
                  <span />
                )}
                {page < pages && (
                  <Link href={pageHref(page + 1)} className={secondaryButtonClass}>
                    Older
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </section>

      {/* Recent counts */}
      {counts.length > 0 && (
        <section className={cardClass} aria-labelledby="counts-title">
          <h2 id="counts-title" className="mb-3 text-base font-bold text-ink">
            Recent cash counts
          </h2>
          <ul className="divide-y divide-line text-sm">
            {counts.map((c) => {
              const diff = toCents(c.difference) ?? BigInt(0);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{accountNames.get(c.account_id) ?? "Account"}</span>
                    <span className="block text-xs text-ink-muted">
                      {formatDateWith(c.created_at, dateFormat, true)} · counted {formatMoney(c.counted_amount, currency)}{" "}
                      · app {formatMoney(c.system_balance, currency)}
                      {c.notes ? ` · ${c.notes}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone={diff === BigInt(0) ? "mint" : diff > BigInt(0) ? "teal" : "coral"}>
                      {diff === BigInt(0)
                        ? "Matched"
                        : `${diff > BigInt(0) ? "+" : ""}${formatMoney(diff, currency)}`}
                    </Pill>
                    {diff !== BigInt(0) && (
                      <span className="text-xs text-ink-muted">{c.adjustment_id ? "Adjusted" : "Not adjusted"}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
