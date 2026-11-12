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

    // A cancelled invoice cannot receive payments
    const { data: sale } = await supabase
      .from("sales")
      .select("status")
      .eq("id", saleId)
      .maybeSingle();
    if ((sale as { status?: string } | null)?.status === "void") {
      return fail("This invoice is cancelled, so it cannot receive payments.");
    }

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

export type CancelSaleResult = { ok: boolean; error: string | null };

// Cancels an invoice: the database puts the items back in stock and records
// the refund of everything the customer paid.
export async function cancelSale(input: { id: string; reason: string }): Promise<CancelSaleResult> {
  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes("returns.manage")) {
      return { ok: false, error: "You do not have permission to cancel invoices." };
    }
    const saleId = input?.id;
    if (typeof saleId !== "string" || !UUID_PATTERN.test(saleId)) {
      return { ok: false, error: "The sale is not valid." };
    }
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 200) : "";

    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_sale", {
      p_payload: reason ? { sale_id: saleId, reason } : { sale_id: saleId },
    });
    if (error) {
      // The database raises clear English messages; show them as they are
      return { ok: false, error: error.message };
    }

    revalidatePath(`/sales/${saleId}`);
    revalidatePath("/sales");
    revalidatePath("/customers", "layout");
    revalidatePath("/inventory");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    console.error("cancelSale error:", e);
    return { ok: false, error: "The invoice could not be cancelled. Please try again." };
  }
}
