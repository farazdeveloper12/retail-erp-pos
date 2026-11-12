import type { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/money";

type Db = Awaited<ReturnType<typeof createClient>>;

// Sum (in cents) of the later supplier payments for each purchase, from
// purchase_payments. This is history only: record_supplier_payment already
// adds every payment to purchases.paid_amount, so a purchase's balance is
// always total - paid_amount. Never subtract these sums from the balance.
export async function laterPaymentsByPurchase(
  supabase: Db,
  purchaseIds: string[]
): Promise<Map<string, bigint>> {
  const sums = new Map<string, bigint>();
  if (purchaseIds.length === 0) return sums;

  const { data, error } = await supabase
    .from("purchase_payments")
    .select("purchase_id, amount")
    .in("purchase_id", purchaseIds);
  if (error) {
    console.error("laterPaymentsByPurchase error:", error.message);
    return sums;
  }

  for (const row of (data ?? []) as { purchase_id: string; amount: number | string | null }[]) {
    const cents = toCents(row.amount);
    if (cents === null) continue;
    sums.set(row.purchase_id, (sums.get(row.purchase_id) ?? BigInt(0)) + cents);
  }
  return sums;
}
