import "server-only";
import { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";

// Permission that allows seeing cost and profit
export const COST_PERMISSION = "inventory.view_cost";

export type SaleProfit = {
  costTotal: bigint;
  costMissing: boolean;
  // Before VAT: total - VAT - cost
  profit: bigint;
  // Profit reversed by returns (before VAT)
  returnsProfit: bigint;
  netProfit: bigint;
};

type ProfitRow = {
  sale_id: string;
  cost_total: number | string;
  cost_missing: boolean;
  profit: number | string;
  returns_profit: number | string;
  net_profit: number | string;
};

const ZERO = BigInt(0);

// Profit per sale, calculated by the database. Call it only for users with
// COST_PERMISSION; the database checks the permission again.
export async function getSaleProfits(saleIds: string[]): Promise<Map<string, SaleProfit>> {
  const result = new Map<string, SaleProfit>();
  if (saleIds.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_sale_profits", { p_sale_ids: saleIds });
  if (error) {
    console.error("get_sale_profits error:", error.message);
    return result;
  }
  for (const row of (data ?? []) as ProfitRow[]) {
    result.set(row.sale_id, {
      costTotal: toCents(row.cost_total) ?? ZERO,
      costMissing: row.cost_missing === true,
      profit: toCents(row.profit) ?? ZERO,
      returnsProfit: toCents(row.returns_profit) ?? ZERO,
      netProfit: toCents(row.net_profit) ?? ZERO,
    });
  }
  return result;
}
