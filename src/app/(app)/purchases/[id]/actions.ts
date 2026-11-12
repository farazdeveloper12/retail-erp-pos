"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

export type PaySupplierResult = {
  ok: boolean;
  error: string | null;
  balance: number | null;
};

const MAX_AMOUNT = 1_000_000_000_000;

// Records a later payment to the supplier for one purchase
export async function paySupplier(input: unknown): Promise<PaySupplierResult> {
  const fail = (error: string): PaySupplierResult => ({ ok: false, error, balance: null });

  try {
    const permissions = await getMyPermissions();
    if (!hasAny(permissions, ["purchases.manage", "suppliers.manage"])) {
      return fail("You do not have permission to pay suppliers.");
    }

    const raw = (typeof input === "object" && input !== null ? input : {}) as Record<
      string,
      unknown
    >;
    const purchaseId = raw.purchase_id;
    const amount = raw.amount;
    const method = raw.payment_method;

    if (typeof purchaseId !== "string" || !UUID_PATTERN.test(purchaseId)) {
      return fail("The purchase is not valid.");
    }
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_AMOUNT ||
      Math.round(amount * 100) / 100 !== amount
    ) {
      return fail("Enter an amount above zero with up to 2 decimals.");
    }
    if (method !== "cash" && method !== "bank") {
      return fail("Choose Cash or Bank as the payment method.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_supplier_payment", {
      p_payload: { purchase_id: purchaseId, amount, payment_method: method },
    });

    if (error) {
      // The database raises clear English messages; show them as they are
      return fail(error.message);
    }

    revalidatePath(`/purchases/${purchaseId}`);
    revalidatePath("/purchases");
    revalidatePath("/suppliers", "layout");
    const balance = (data as { balance?: unknown } | null)?.balance;
    return { ok: true, error: null, balance: typeof balance === "number" ? balance : null };
  } catch (e) {
    console.error("paySupplier error:", e);
    return fail("The payment could not be saved. Please try again.");
  }
}
