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

    // A cancelled purchase cannot be paid
    const { data: purchase } = await supabase
      .from("purchases")
      .select("status")
      .eq("id", purchaseId)
      .maybeSingle();
    if ((purchase as { status?: string } | null)?.status === "void") {
      return fail("This purchase is cancelled, so it cannot be paid.");
    }

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

export type CancelPurchaseResult = { ok: boolean; error: string | null };

// Cancels a purchase: the database removes its items from stock and records
// the money paid to the supplier as returned. It refuses when something from
// this purchase was already sold or used.
export async function cancelPurchase(input: {
  id: string;
  reason: string;
}): Promise<CancelPurchaseResult> {
  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes("purchases.manage")) {
      return { ok: false, error: "You do not have permission to cancel purchases." };
    }
    const purchaseId = input?.id;
    if (typeof purchaseId !== "string" || !UUID_PATTERN.test(purchaseId)) {
      return { ok: false, error: "The purchase is not valid." };
    }
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 200) : "";

    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_purchase", {
      p_payload: reason ? { purchase_id: purchaseId, reason } : { purchase_id: purchaseId },
    });
    if (error) {
      // The database raises clear English messages; show them as they are
      return { ok: false, error: error.message };
    }

    revalidatePath(`/purchases/${purchaseId}`);
    revalidatePath("/purchases");
    revalidatePath("/suppliers", "layout");
    revalidatePath("/inventory");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    console.error("cancelPurchase error:", e);
    return { ok: false, error: "The purchase could not be cancelled. Please try again." };
  }
}
