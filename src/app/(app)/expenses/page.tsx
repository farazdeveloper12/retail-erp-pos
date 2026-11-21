import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
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
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { centsToPlain, formatMoney, toCents } from "@/lib/money";
import { paymentMethodLabel } from "@/lib/format";
import ExpenseForm from "@/app/(app)/expenses/ExpenseForm";
import CancelExpenseButton from "@/app/(app)/expenses/CancelExpenseButton";
import ExpenseActions from "@/app/(app)/expenses/ExpenseActions";

export const metadata: Metadata = {
  title: "Expenses",
};

type ExpenseRow = {
  id: string;
  expense_date: string;
  category: string;
  description: string | null;
  amount: number | string | null;
  account: string | null;
};

// Suggested categories; previously used ones are added to the type-ahead too
const COMMON_CATEGORIES = [
  "Rent",
  "Employee salary",
  "Electricity",
  "Water",
  "Internet",
  "Transport",
  "Food",
  "Tea",
  "Maintenance",
  "Parking",
  "Marketing",
  "Other",
];
const LIST_SIZE = 50;
const MONTH_LIMIT = 2000;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Today's date in Pakistan time, as YYYY-MM-DD
function todayInKarachi() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nextMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, m - 1, 1))
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}

// Keeps the month and the "Show cancelled" choice in links
function pageHref(month: string, showCancelled: boolean) {
  const search = new URLSearchParams({ month });
  if (showCancelled) search.set("cancelled", "1");
  return `/expenses?${search.toString()}`;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; cancelled?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "expenses")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("expenses.manage");
  const canEditEntries = permissions.includes("entries.edit");
  const canDeleteEntries = permissions.includes("entries.delete");
  const showActions = canManage || canEditEntries || canDeleteEntries;

  const today = todayInKarachi();
  const { month: monthParam, cancelled } = await searchParams;
  const month = monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : today.slice(0, 7);
  const showCancelled = cancelled === "1";
  const monthStart = `${month}-01`;
  const monthEnd = `${nextMonth(month)}-01`;

  const supabase = await createClient();
  const [{ data, error }, { data: categoryData }, business, { data: cancelledData }] = await Promise.all([
    // Active expenses only: cancelled ones never count in the list or totals
    supabase
      .from("expenses")
      .select("id, expense_date, category, description, amount, account")
      .is("voided_at", null)
      .is("deleted_at", null)
      .gte("expense_date", monthStart)
      .lt("expense_date", monthEnd)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MONTH_LIMIT),
    // Previous categories for the type-ahead
    supabase
      .from("expenses")
      .select("category")
      .order("created_at", { ascending: false })
      .limit(500),
    getMyBusiness(),
    // Cancelled expenses, only when asked for; shown greyed out, never counted
    showCancelled
      ? supabase
          .from("expenses")
          .select("id, expense_date, category, description, amount, account")
          .not("voided_at", "is", null)
          .is("deleted_at", null)
          .gte("expense_date", monthStart)
          .lt("expense_date", monthEnd)
          .order("expense_date", { ascending: false })
          .limit(LIST_SIZE)
      : Promise.resolve({ data: [] }),
  ]);
  const currency = business?.currency_code || "PKR";
  const expenses = (data ?? []) as ExpenseRow[];
  const cancelledExpenses = (cancelledData ?? []) as ExpenseRow[];

  // Suggestions: categories managed in Settings (or the common list when
  // none were added yet) plus categories used before
  const { data: managedData } = await supabase
    .from("expense_categories")
    .select("name")
    .eq("is_active", true)
    .order("name");
  const managed = ((managedData ?? []) as { name: string }[]).map((row) => row.name);
  const categories = [
    ...new Set([
      ...((categoryData ?? []) as { category: string }[])
        .map((row) => row.category?.trim())
        .filter((name): name is string => Boolean(name)),
      ...(managed.length > 0 ? managed : COMMON_CATEGORIES),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  // Month total and total per category, in exact cents
  let monthTotal = BigInt(0);
  const byCategory = new Map<string, bigint>();
  for (const expense of expenses) {
    const cents = toCents(expense.amount) ?? BigInt(0);
    monthTotal += cents;
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? BigInt(0)) + cents);
  }
  const categoryTotals = [...byCategory.entries()].sort((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1
  );
  const shown = expenses.slice(0, LIST_SIZE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Receipt}
        title="Expenses"
        description="Rent, salaries, utilities and other running costs."
      />

      {canManage && <ExpenseForm today={today} categories={categories} currency={currency} />}

      {/* Month filter and totals */}
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <form method="get" className={cardClass + " space-y-3"}>
          {showCancelled && <input type="hidden" name="cancelled" value="1" />}
          <label htmlFor="expense-month" className={labelClass}>
            Month
          </label>
          <div className="flex gap-2">
            <input
              id="expense-month"
              name="month"
              type="month"
              defaultValue={month}
              className={inputClass}
            />
            <button type="submit" className={primaryButtonClass}>
              Show
            </button>
          </div>
        </form>
        <div className="flex flex-col justify-center rounded-card bg-peach px-5 py-4">
          <p className="text-sm font-medium text-ink">Total for this month</p>
          <p className="text-xs text-ink-muted">{monthLabel(month)}</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatMoney(monthTotal, currency)}</p>
        </div>
        <div className={cardClass}>
          <p className="mb-2 text-sm font-bold text-ink">By category</p>
          {categoryTotals.length === 0 ? (
            <p className="text-xs text-ink-muted">No expenses in this month.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {categoryTotals.map(([name, total]) => (
                <li key={name} className="flex justify-between gap-3">
                  <span className="truncate text-ink-muted">{name}</span>
                  <span className="font-semibold text-ink">{formatMoney(total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Expense list */}
      {error ? (
        <Notice kind="error">Could not load expenses: {error.message}</Notice>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses in this month"
          text={
            canManage
              ? "Use the form above to add the first expense."
              : "Expenses will appear here once they are recorded."
          }
        />
      ) : (
        <section aria-label="Expenses" className="space-y-3">
          <p className="text-sm text-ink-muted">
            {expenses.length > LIST_SIZE
              ? `Showing the latest ${LIST_SIZE} of ${expenses.length} expenses`
              : `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"}`}
          </p>

          <ul className="space-y-3 md:hidden">
            {shown.map((expense) => (
              <li key={expense.id} className={cardClass}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{expense.category}</p>
                    {expense.description && (
                      <p className="mt-0.5 text-sm text-ink-muted">{expense.description}</p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatDate(expense.expense_date)} · {paymentMethodLabel(expense.account)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-ink">{formatMoney(expense.amount, currency)}</p>
                </div>
                {showActions && (
                  <div className="mt-3 flex flex-wrap justify-end gap-1">
                    {canManage && !canDeleteEntries && <CancelExpenseButton expenseId={expense.id} />}
                    <ExpenseActions
                      expense={{
                        id: expense.id,
                        amount: centsToPlain(toCents(expense.amount) ?? BigInt(0)),
                        expense_date: expense.expense_date,
                        category: expense.category,
                        description: expense.description ?? "",
                      }}
                      currency={currency}
                      canEdit={canEditEntries}
                      canDelete={canDeleteEntries}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Paid from</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  {showActions && (
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((expense) => (
                  <tr key={expense.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                      {formatDate(expense.expense_date)}
                    </td>
                    <td className="px-5 py-3 font-semibold text-ink">{expense.category}</td>
                    <td className="max-w-xs truncate px-5 py-3 text-ink-muted">
                      {expense.description || "—"}
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{paymentMethodLabel(expense.account)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink">
                      {formatMoney(expense.amount, currency)}
                    </td>
                    {showActions && (
                      <td className="px-5 py-2">
                        <span className="flex flex-wrap justify-end gap-1">
                          {canManage && !canDeleteEntries && <CancelExpenseButton expenseId={expense.id} />}
                          <ExpenseActions
                      expense={{
                        id: expense.id,
                        amount: centsToPlain(toCents(expense.amount) ?? BigInt(0)),
                        expense_date: expense.expense_date,
                        category: expense.category,
                        description: expense.description ?? "",
                      }}
                      currency={currency}
                      canEdit={canEditEntries}
                      canDelete={canDeleteEntries}
                    />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Cancelled expenses: hidden by default, never counted in totals */}
      <section className="space-y-3">
        <Link
          href={pageHref(month, !showCancelled)}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:text-accent-strong"
        >
          {showCancelled ? "Hide cancelled" : "Show cancelled"}
        </Link>
        {showCancelled &&
          (cancelledExpenses.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
              No cancelled expenses in this month.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface opacity-70">
              {cancelledExpenses.map((expense) => (
                <li
                  key={expense.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-ink-muted"
                >
                  <span className="min-w-0">
                    <span className="font-semibold line-through">{expense.category}</span>
                    {expense.description ? ` · ${expense.description}` : ""}
                    <span className="block text-xs">
                      {formatDate(expense.expense_date)} · {paymentMethodLabel(expense.account)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill tone="neutral">Cancelled</Pill>
                    <span className="font-semibold line-through">
                      {formatMoney(expense.amount, currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
