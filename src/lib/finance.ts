import type { createClient } from "@/lib/supabase/server";
import { addDays, todayInKarachi } from "@/lib/dashboard";

type Db = Awaited<ReturnType<typeof createClient>>;

// ---------- Accounts ----------

export type AccountKind = "cash" | "bank" | "wallet";

export const ACCOUNT_KINDS: { value: AccountKind; label: string; hint: string }[] = [
  { value: "cash", label: "Cash", hint: "Cash drawer or cash in hand" },
  { value: "bank", label: "Bank", hint: "A bank account" },
  { value: "wallet", label: "Wallet", hint: "Mobile wallet such as JazzCash or Easypaisa" },
];

export function accountKindLabel(kind: string | null | undefined) {
  return ACCOUNT_KINDS.find((k) => k.value === kind)?.label ?? "Account";
}

export type FinanceAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  details: string | null;
  opening_balance: number | string;
  opening_date: string;
  is_default: boolean;
  is_active: boolean;
  balance: number | string;
  total_in: number | string;
  total_out: number | string;
  entry_count: number;
  last_entry_date: string | null;
};

export const ACCOUNT_COLUMNS =
  "id, name, kind, details, opening_balance, opening_date, is_default, is_active, balance, total_in, total_out, entry_count, last_entry_date";

export async function fetchAccounts(supabase: Db) {
  const { data, error } = await supabase
    .from("finance_account_balances")
    .select(ACCOUNT_COLUMNS)
    .order("name");
  // Active first, then cash, bank, wallets; the default first within a kind
  const kindOrder: Record<string, number> = { cash: 0, bank: 1, wallet: 2 };
  const accounts = ((data ?? []) as FinanceAccount[]).sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) ||
      (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) ||
      Number(b.is_default) - Number(a.is_default) ||
      a.name.localeCompare(b.name)
  );
  return { accounts, error: error?.message ?? null };
}

// ---------- Entry types ----------

export const CATEGORY_LABELS: Record<string, string> = {
  sale_receipt: "Sale receipt",
  customer_payment: "Customer payment",
  supplier_payment: "Supplier payment",
  expense: "Expense",
  other: "Other",
  opening_balance: "Opening balance",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  transfer: "Transfer",
  owner_capital_in: "Owner capital in",
  owner_capital_out: "Owner drawing",
  adjustment: "Adjustment",
  sale_refund: "Sale refund",
  purchase_refund: "Purchase refund",
  customer_purchase: "Phone bought from customer",
};

export function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category;
}

// Types offered in the ledger filter
export const FILTER_TYPES = Object.keys(CATEGORY_LABELS);

// Types the user can record by hand
export type ManualType =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "owner_capital_in"
  | "owner_capital_out"
  | "adjustment";

export const MANUAL_TYPES: { value: ManualType; label: string; hint: string }[] = [
  { value: "deposit", label: "Deposit", hint: "Money comes into the account, for example a loan received." },
  { value: "withdrawal", label: "Withdrawal", hint: "Money leaves the account for something that is not an expense." },
  { value: "transfer", label: "Transfer", hint: "Move money between two accounts, for example cash to bank." },
  { value: "owner_capital_in", label: "Owner capital in", hint: "The owner puts money into the business." },
  { value: "owner_capital_out", label: "Owner drawing", hint: "The owner takes money out of the business." },
  { value: "adjustment", label: "Adjustment", hint: "A correction. A note is required." },
];

// Text for an entry: its note, or a description from its source
export function entryDescription(row: { category: string; ref_type: string | null; notes: string | null }) {
  if (row.notes) return row.notes;
  if (row.ref_type === "sale") return row.category === "customer_payment" ? "Payment on invoice" : "Paid at sale";
  if (row.ref_type === "purchase") return "Paid to supplier";
  return categoryLabel(row.category);
}

// Link to the document behind an entry, when there is one
export function entrySourceHref(row: { ref_type: string | null; ref_id: string | null }) {
  if (!row.ref_id) return null;
  if (row.ref_type === "sale" || row.ref_type === "sale_void") return `/sales/${row.ref_id}`;
  if (row.ref_type === "purchase" || row.ref_type === "purchase_void") return `/purchases/${row.ref_id}`;
  if (row.ref_type === "expense" || row.ref_type === "expense_void") return "/expenses";
  if (row.ref_type === "sales_return") return `/returns/sales/${row.ref_id}`;
  if (row.ref_type === "purchase_return") return `/returns/purchases/${row.ref_id}`;
  if (row.ref_type === "customer_purchase") return `/purchases/from-customers/${row.ref_id}`;
  return null;
}

export function canCancelEntry(row: {
  ref_type: string | null;
  voided_at: string | null;
  reversal_of: string | null;
}) {
  return (row.ref_type === "manual" || row.ref_type === "transfer") && !row.voided_at && !row.reversal_of;
}

// ---------- Ledger filters ----------

export type LedgerFilters = {
  account: string | null;
  from: string;
  to: string;
  type: string | null;
  q: string;
  group: "day" | "month";
  error: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RANGE_DAYS = 1100;

function validDate(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

export function parseLedgerFilters(params: Record<string, string | undefined>): LedgerFilters {
  const today = todayInKarachi();
  let from = validDate(params.from) ?? `${today.slice(0, 7)}-01`;
  let to = validDate(params.to) ?? today;
  let error: string | null = null;
  if (to < from) {
    error = "The end date is before the start date, so the dates were swapped.";
    [from, to] = [to, from];
  }
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_RANGE_DAYS * 86400000) {
    error = "Choose at most three years. The start date was moved.";
    from = addDays(to, -MAX_RANGE_DAYS);
  }
  const type = params.type && FILTER_TYPES.includes(params.type) ? params.type : null;
  const account = params.account && UUID.test(params.account) ? params.account : null;
  const q = (params.q ?? "").trim().slice(0, 80);
  const group = params.group === "month" ? "month" : "day";
  return { account, from, to, type, q, group, error };
}

export function filtersToSearch(filters: LedgerFilters, extra: Record<string, string> = {}) {
  const search = new URLSearchParams();
  if (filters.account) search.set("account", filters.account);
  search.set("from", filters.from);
  search.set("to", filters.to);
  if (filters.type) search.set("type", filters.type);
  if (filters.q) search.set("q", filters.q);
  if (filters.group === "month") search.set("group", "month");
  for (const [k, v] of Object.entries(extra)) search.set(k, v);
  return search.toString();
}

// ---------- Ledger rows ----------

export type LedgerRow = {
  id: string;
  entry_date: string;
  created_at: string;
  account_id: string;
  account_name: string;
  account_kind: AccountKind;
  direction: "in" | "out";
  amount: number | string;
  category: string;
  party_type: string | null;
  party_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  notes: string | null;
  voided_at: string | null;
  reversal_of: string | null;
  signed_amount: number | string;
  running_balance: number | string;
};

export const LEDGER_COLUMNS =
  "id, entry_date, created_at, account_id, account_name, account_kind, direction, amount, category, party_type, party_id, ref_type, ref_id, notes, voided_at, reversal_of, signed_amount, running_balance";

// Removes characters that have a meaning in PostgREST filters
function searchTerm(q: string) {
  return q.replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchLedger(
  supabase: Db,
  filters: LedgerFilters,
  options: { limit: number; offset?: number; ascending?: boolean }
) {
  let query = supabase
    .from("finance_ledger")
    .select(LEDGER_COLUMNS, { count: "exact" })
    .gte("entry_date", filters.from)
    .lte("entry_date", filters.to);
  if (filters.account) query = query.eq("account_id", filters.account);
  if (filters.type) query = query.eq("category", filters.type);
  const term = searchTerm(filters.q);
  if (term) query = query.or(`notes.ilike.*${term}*,account_name.ilike.*${term}*`);

  const ascending = options.ascending ?? false;
  const offset = options.offset ?? 0;
  const { data, error, count } = await query
    .order("entry_date", { ascending })
    .order("created_at", { ascending })
    .order("id", { ascending })
    .range(offset, offset + options.limit - 1);

  return { rows: (data ?? []) as LedgerRow[], count: count ?? 0, error: error?.message ?? null };
}
