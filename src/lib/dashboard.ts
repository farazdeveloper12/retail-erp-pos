import type { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";

type Db = Awaited<ReturnType<typeof createClient>>;
type Raw = Record<string, unknown>;

// ---------- Period (Pakistan time) ----------

export type PeriodKey = "today" | "7d" | "month" | "custom";

export type Period = {
  key: PeriodKey;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  label: string;
  error: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

// Today's date in Asia/Karachi, as YYYY-MM-DD (not UTC)
export function todayInKarachi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function isRealDate(value: string | undefined): value is string {
  return Boolean(value && DATE_PATTERN.test(value) && !Number.isNaN(toUtc(value)) &&
    new Date(toUtc(value)).toISOString().slice(0, 10) === value);
}

export function formatDay(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );
}

// Every day from `from` to `to`, inclusive
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = toUtc(from); t <= toUtc(to) && days.length <= MAX_RANGE_DAYS; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

// Reads ?period=today|7d|month|custom&from=&to= and returns a safe range
export function resolvePeriod(params: { period?: string; from?: string; to?: string }): Period {
  const today = todayInKarachi();
  const todayPeriod: Period = { key: "today", from: today, to: today, label: "Today", error: null };

  switch (params.period) {
    case "7d":
      return { key: "7d", from: addDays(today, -6), to: today, label: "Last 7 days", error: null };
    case "month":
      return { key: "month", from: `${today.slice(0, 7)}-01`, to: today, label: "This month", error: null };
    case "custom": {
      const from = params.from;
      const to = params.to;
      if (!isRealDate(from) || !isRealDate(to)) {
        // No dates chosen yet: start with the last 30 days
        if (!from && !to) {
          return { key: "custom", from: addDays(today, -29), to: today, label: "Custom", error: null };
        }
        return { ...todayPeriod, key: "custom", error: "Choose a valid start and end date." };
      }
      if (from > to) {
        return { ...todayPeriod, key: "custom", error: "The start date must be before the end date." };
      }
      if ((toUtc(to) - toUtc(from)) / DAY_MS + 1 > MAX_RANGE_DAYS) {
        return { ...todayPeriod, key: "custom", error: "The period can be at most one year." };
      }
      return {
        key: "custom",
        from,
        to,
        label: from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`,
        error: null,
      };
    }
    default:
      return todayPeriod;
  }
}

// ---------- Dashboard data ----------

export type DailyRow = {
  day: string;
  salesCount: number;
  salesTotal: bigint;
  profit: bigint | null;
};

export type TopItem = { description: string; qty: number; amount: bigint };
export type CategoryTotal = { category: string; amount: bigint };

export type DashboardData = {
  financial: boolean;
  salesTotal: bigint;
  salesCount: number;
  salesPaid: bigint;
  receivable: bigint;
  phonesInStock: number;
  accessoryUnits: number;
  lowStockCount: number;
  daily: DailyRow[];
  topItems: TopItem[];
  // Financial figures: always null when financial is false
  profit: bigint | null;
  purchasesTotal: bigint | null;
  expensesTotal: bigint | null;
  payable: bigint | null;
  cashBalance: bigint | null;
  bankBalance: bigint | null;
  stockValue: bigint | null;
  expensesByCategory: CategoryTotal[];
};

const ZERO = BigInt(0);

function money(value: unknown): bigint {
  return toCents(value) ?? ZERO;
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === "object") as Raw[]) : [];
}

// Parses the get_dashboard JSON safely; numbers may arrive as strings
export function parseDashboard(raw: unknown): DashboardData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const financial = data.financial === true;
  const fin = (value: unknown) => (financial ? money(value) : null);

  return {
    financial,
    salesTotal: money(data.sales_total),
    salesCount: count(data.sales_count),
    salesPaid: money(data.sales_paid),
    receivable: money(data.receivable),
    phonesInStock: count(data.phones_in_stock),
    accessoryUnits: count(data.accessory_units),
    lowStockCount: count(data.low_stock_count),
    daily: list(data.daily)
      .filter((row) => typeof row.day === "string")
      .map((row) => ({
        day: String(row.day).slice(0, 10),
        salesCount: count(row.sales_count),
        salesTotal: money(row.sales_total),
        profit: financial ? money(row.profit) : null,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    topItems: list(data.top_items).map((row) => ({
      description: String(row.description ?? "Item"),
      qty: count(row.qty),
      amount: money(row.amount),
    })),
    profit: fin(data.profit),
    purchasesTotal: fin(data.purchases_total),
    expensesTotal: fin(data.expenses_total),
    payable: fin(data.payable),
    cashBalance: fin(data.cash_balance),
    bankBalance: fin(data.bank_balance),
    stockValue: fin(data.stock_value),
    expensesByCategory: financial
      ? list(data.expenses_by_category).map((row) => ({
          category: String(row.category ?? "Other"),
          amount: money(row.amount),
        }))
      : [],
  };
}

export async function fetchDashboard(
  supabase: Db,
  from: string,
  to: string
): Promise<{ data: DashboardData | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_dashboard", { p_from: from, p_to: to });
  if (error) {
    // The database raises clear English messages, for example a missing permission
    return { data: null, error: error.message };
  }
  return { data: parseDashboard(data), error: null };
}

// One row per day of the period, with zero for days without sales
export function fillDays(period: { from: string; to: string }, daily: DailyRow[], financial: boolean) {
  const byDay = new Map(daily.map((row) => [row.day, row]));
  return daysBetween(period.from, period.to).map(
    (day) =>
      byDay.get(day) ?? { day, salesCount: 0, salesTotal: ZERO, profit: financial ? ZERO : null }
  );
}
