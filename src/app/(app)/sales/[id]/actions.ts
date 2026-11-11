"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

export type ReceivePaymentResult = {
  ok: boolean;
  error: string | null;
  balance: number | null;
};

const MAX_AMOUNT = 1_000_000_000_000;

// Records a later payment against a sale through the database function
export async function receiveSalePayment(input: unknown): Promise<ReceivePaymentResult> {
  const fail = (error: string): ReceivePaymentResult => ({ ok: false, error, balance: null });

  try {
    const permissions = await getMyPermissions();
    if (!hasAny(permissions, ["sales.create", "customers.manage"])) {
      return fail("You do not have permission to receive payments.");
    }

    const raw = (typeof input === "object" && input !== null ? input : {}) as Record<
      string,
      unknown
    >;
    const saleId = raw.sale_id;
    const amount = raw.amount;
    const method = raw.payment_method;

    if (typeof saleId !== "string" || !UUID_PATTERN.test(saleId)) {
      return fail("The sale is not valid.");
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
    const { data, error } = await supabase.rpc("record_customer_payment", {
      p_payload: { sale_id: saleId, amount, payment_method: method },
    });

    if (error) {
      // The database raises clear English messages; show them as they are
      return fail(error.message);
    }

    revalidatePath(`/sales/${saleId}`);
    revalidatePath("/sales");
    const balance = (data as { balance?: unknown } | null)?.balance;
    return {
      ok: true,
      error: null,
      balance: typeof balance === "number" ? balance : null,
    };
  } catch (e) {
    console.error("receiveSalePayment error:", e);
    return fail("The payment could not be saved. Please try again.");
  }
}
