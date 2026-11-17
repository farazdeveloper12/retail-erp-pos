import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/dashboard";

type Db = Awaited<ReturnType<typeof createClient>>;
type Json = Record<string, unknown>;

// The fixed list of READ-ONLY tools the assistant may call. Each one reads
// through the signed-in user's Supabase session, so Row Level Security and the
// user's permissions decide what comes back. There is no tool that writes, and
// no tool accepts SQL.

const DATE = { type: "string", description: "Date as YYYY-MM-DD (Pakistan time)." } as const;

export const AI_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_sales_summary",
    description:
      "Sales for a date range: total sales after returns, number of invoices, returns, cash received on sales, amount customers still owe (all time), and sales per day. Use it for questions about sales, revenue or how a day, week or month went.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_profit_and_expenses",
    description:
      "Profit, expenses by category, purchases and amounts owed to suppliers for a date range. Only works for users with financial permission.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_stock_overview",
    description:
      "Current stock: phones in stock grouped by model and storage, accessories with their quantity, and accessories at or below the low stock threshold.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_top_products",
    description: "Best selling items (phones and accessories) by amount for a date range, up to 10.",
    input_schema: {
      type: "object",
      properties: { from: DATE, to: DATE },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_top_customers",
    description: "Customers with the highest sales after returns for a date range. Returns names and totals only.",
    input_schema: {
      type: "object",
      properties: {
        from: DATE,
        to: DATE,
        limit: { type: "integer", description: "How many customers, 1 to 25. Default 10." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "get_receivables_and_payables",
    description:
      "Who owes the shop money (customers) and whom the shop owes money (suppliers), largest first, with totals. Names and amounts only.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_cash_and_bank_balances",
    description: "Current balance of every active cash, bank and wallet account, and the total.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "lookup_warranty",
    description:
      "Warranty status of sold items found by IMEI (15 digits), invoice number (for example INV-000042) or the customer's phone number. Returns the item, invoice, sale date, warranty end date and status.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "IMEI, invoice number or customer phone number." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(AI_TOOLS.map((t) => t.name));
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ToolInputError extends Error {}

function onlyKeys(input: Json, allowed: string[]) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ToolInputError(`Unknown field "${key}".`);
  }
}

function readRange(input: Json) {
  const from = input.from;
  const to = input.to;
  if (typeof from !== "string" || !DATE_PATTERN.test(from) || typeof to !== "string" || !DATE_PATTERN.test(to)) {
    throw new ToolInputError("from and to must be dates as YYYY-MM-DD.");
  }
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    throw new ToolInputError("from and to must be real dates.");
  }
  if (to < from) throw new ToolInputError("to must not be before from.");
  if (from < addDays(to, -366)) throw new ToolInputError("The range can be at most one year.");
  return { from, to };
}

async function dashboard(db: Db, from: string, to: string) {
  const { data, error } = await db.rpc("get_dashboard", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Json;
}

// Hides most digits of a phone number before it is sent to the model
function maskPhone(value: unknown) {
  if (typeof value !== "string" || value.length < 4) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-3)}` : null;
}

type Ctx = { db: Db; permissions: string[] };

async function run(name: string, input: Json, { db, permissions }: Ctx): Promise<unknown> {
  const can = (...keys: string[]) => keys.some((k) => permissions.includes(k));

  switch (name) {
    case "get_sales_summary": {
      onlyKeys(input, ["from", "to"]);
      const { from, to } = readRange(input);
      const d = await dashboard(db, from, to);
      return {
        from,
        to,
        sales_total_after_returns: d.sales_total,
        returns_total: d.returns_total,
        invoices: d.sales_count,
        cash_received_on_these_sales: d.sales_paid,
        customers_owe_all_time: d.receivable,
        per_day: d.daily,
      };
    }
    case "get_profit_and_expenses": {
      onlyKeys(input, ["from", "to"]);
      const { from, to } = readRange(input);
      const d = await dashboard(db, from, to);
      if (d.financial !== true) return { error: "This user does not have permission to see profit and expenses." };
      return {
        from,
        to,
        profit_on_sales: d.profit,
        expenses_total: d.expenses_total,
        profit_after_expenses:
          d.profit !== undefined && d.expenses_total !== undefined
            ? (Number(d.profit) - Number(d.expenses_total)).toFixed(2)
            : null,
        expenses_by_category: d.expenses_by_category,
        purchases_total_after_returns: d.purchases_total,
        owed_to_suppliers_all_time: d.payable,
        stock_value_at_cost: d.stock_value,
      };
    }
    case "get_stock_overview": {
      onlyKeys(input, []);
      if (!can("inventory.view")) return { error: "This user does not have permission to see stock." };
      const [{ data: phones }, { data: stock }, { data: products }, { data: biz }] = await Promise.all([
        db
          .from("phone_units")
          .select("brand_name, model_name, storage_gb, condition")
          .eq("status", "in_stock")
          .limit(5000),
        db.from("product_stock").select("product_id, qty").limit(5000),
        db.from("products").select("id, name, is_active").limit(5000),
        db.from("businesses").select("low_stock_threshold").limit(1).maybeSingle(),
      ]);
      const groups = new Map<string, number>();
      for (const p of (phones ?? []) as { brand_name: string; model_name: string; storage_gb: number; condition: string }[]) {
        const key = `${p.brand_name} ${p.model_name} ${p.storage_gb} GB (${p.condition})`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      const names = new Map(((products ?? []) as { id: string; name: string; is_active: boolean }[]).map((p) => [p.id, p]));
      const threshold = Number((biz as { low_stock_threshold?: number } | null)?.low_stock_threshold ?? 5);
      const accessories = ((stock ?? []) as { product_id: string; qty: number | string }[])
        .map((s) => ({ name: names.get(s.product_id)?.name ?? "Item", active: names.get(s.product_id)?.is_active ?? true, qty: Number(s.qty) }))
        .filter((a) => a.active)
        .sort((a, b) => a.qty - b.qty);
      return {
        phones_in_stock: [...groups.entries()].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count).slice(0, 100),
        phones_total: (phones ?? []).length,
        accessories: accessories.slice(0, 150).map(({ name, qty }) => ({ name, qty })),
        low_stock_threshold: threshold,
        low_stock: accessories.filter((a) => a.qty <= threshold).map(({ name, qty }) => ({ name, qty })),
      };
    }
    case "get_top_products": {
      onlyKeys(input, ["from", "to"]);
      const { from, to } = readRange(input);
      const d = await dashboard(db, from, to);
      return { from, to, top_items: d.top_items };
    }
    case "get_top_customers": {
      onlyKeys(input, ["from", "to", "limit"]);
      const { from, to } = readRange(input);
      const limit = input.limit === undefined ? 10 : input.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 25) {
        throw new ToolInputError("limit must be a whole number from 1 to 25.");
      }
      if (!can("sales.view_all")) return { error: "This user does not have permission to see all sales." };
      const { data, error } = await db.rpc("ai_top_customers", { p_from: from, p_to: to, p_limit: limit });
      if (error) throw new Error(error.message);
      return { from, to, customers: data };
    }
    case "get_receivables_and_payables": {
      onlyKeys(input, []);
      const result: Json = {};
      if (can("customers.view", "customers.manage")) {
        const { data: balances } = await db.from("customer_balances").select("customer_id, balance").gt("balance", 0).order("balance", { ascending: false }).limit(200);
        const rows = (balances ?? []) as { customer_id: string; balance: number | string }[];
        const { data: customers } = rows.length
          ? await db.from("customers").select("id, name").in("id", rows.map((r) => r.customer_id))
          : { data: [] };
        const names = new Map(((customers ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
        result.customers_owe_us = rows.slice(0, 25).map((r) => ({ customer: names.get(r.customer_id) ?? "Customer", amount: r.balance }));
        result.customers_owe_us_total = rows.reduce((sum, r) => sum + Number(r.balance), 0).toFixed(2);
      } else {
        result.customers_owe_us = "No permission to see customer balances.";
      }
      if (can("suppliers.view", "suppliers.manage", "purchases.view", "purchases.manage")) {
        const { data: balances } = await db.from("supplier_balances").select("supplier_id, balance").gt("balance", 0).order("balance", { ascending: false }).limit(200);
        const rows = (balances ?? []) as { supplier_id: string; balance: number | string }[];
        const { data: suppliers } = rows.length
          ? await db.from("suppliers").select("id, name").in("id", rows.map((r) => r.supplier_id))
          : { data: [] };
        const names = new Map(((suppliers ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
        result.we_owe_suppliers = rows.slice(0, 25).map((r) => ({ supplier: names.get(r.supplier_id) ?? "Supplier", amount: r.balance }));
        result.we_owe_suppliers_total = rows.reduce((sum, r) => sum + Number(r.balance), 0).toFixed(2);
      } else {
        result.we_owe_suppliers = "No permission to see supplier balances.";
      }
      return result;
    }
    case "get_cash_and_bank_balances": {
      onlyKeys(input, []);
      if (!can("finance.view", "finance.manage")) return { error: "This user does not have permission to see cash and bank." };
      const { data, error } = await db
        .from("finance_account_balances")
        .select("name, kind, balance, is_default")
        .eq("is_active", true)
        .order("name");
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { name: string; kind: string; balance: number | string; is_default: boolean }[];
      return {
        accounts: rows,
        total: rows.reduce((sum, r) => sum + Math.round(Number(r.balance) * 100), 0) / 100,
      };
    }
    case "lookup_warranty": {
      onlyKeys(input, ["query"]);
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (query.length < 2 || query.length > 40) throw new ToolInputError("query must be 2 to 40 characters.");
      const { data, error } = await db.rpc("warranty_lookup", { p_query: query });
      if (error) throw new Error(error.message);
      // Phone numbers are not sent to the model in full
      return ((data ?? []) as Json[]).slice(0, 20).map((row) => ({
        item: row.description,
        imei: row.imei,
        invoice_no: row.invoice_no,
        sold_on: row.sold_on,
        customer: row.customer_name,
        customer_phone: maskPhone(row.customer_phone),
        warranty_days: row.warranty_days,
        warranty_ends: row.expires_on,
        status: row.warranty_status,
        days_left: row.days_left,
        returned_qty: row.returned_qty,
      }));
    }
    default:
      throw new ToolInputError("Unknown tool.");
  }
}

// Runs one tool call and returns the text for the tool_result block
export async function runTool(name: string, input: unknown, ctx: Ctx): Promise<{ content: string; isError: boolean }> {
  if (!TOOL_NAMES.has(name)) return { content: "Unknown tool.", isError: true };
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { content: "The tool input must be an object.", isError: true };
  }
  try {
    const result = await run(name, input as Json, ctx);
    const text = JSON.stringify(result);
    // Keep tool results small
    return { content: text.length > 20000 ? `${text.slice(0, 20000)}…(cut)` : text, isError: false };
  } catch (e) {
    if (e instanceof ToolInputError) return { content: e.message, isError: true };
    console.error(`AI tool ${name} failed:`, e);
    return { content: "The data could not be read.", isError: true };
  }
}

export function toolStatusLabel(name: string) {
  const labels: Record<string, string> = {
    get_sales_summary: "Reading sales",
    get_profit_and_expenses: "Reading profit and expenses",
    get_stock_overview: "Reading stock",
    get_top_products: "Finding best sellers",
    get_top_customers: "Finding top customers",
    get_receivables_and_payables: "Reading balances",
    get_cash_and_bank_balances: "Reading cash and bank",
    lookup_warranty: "Checking warranty",
  };
  return labels[name] ?? "Reading data";
}
