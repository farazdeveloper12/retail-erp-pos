"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { PERMISSION_TRADE_IN, TradeInInputError, parseTradeIn } from "@/lib/trade-in";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BuyFromCustomerResult = {
  ok: boolean;
  error: string | null;
  id: string | null;
};

// Saves a phone bought from a customer (paid from Cash or Bank)
export async function buyFromCustomer(input: unknown): Promise<BuyFromCustomerResult> {
  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes(PERMISSION_TRADE_IN)) {
      return { ok: false, error: "You do not have permission to buy phones from customers.", id: null };
    }
    if (typeof input !== "object" || input === null) {
      return { ok: false, error: "The details are not valid.", id: null };
    }
    const raw = input as Record<string, unknown>;
    const payload = parseTradeIn(raw);

    const method = raw.payment_method;
    if (method !== "cash" && method !== "bank") {
      return { ok: false, error: "Choose Cash or Bank for the payment.", id: null };
    }
    payload.payment_method = method;
    if (raw.purchase_date !== undefined && raw.purchase_date !== null && raw.purchase_date !== "") {
      if (typeof raw.purchase_date !== "string" || !DATE_PATTERN.test(raw.purchase_date)) {
        return { ok: false, error: "The date is not valid.", id: null };
      }
      payload.purchase_date = raw.purchase_date;
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("buy_from_customer", { p_payload: payload });
    if (error) {
      // The database raises clear English messages; show them as they are
      return { ok: false, error: error.message, id: null };
    }

    revalidatePath("/purchases/from-customers");
    revalidatePath("/inventory");
    revalidatePath("/finance");
    const id = (data as { id?: string } | null)?.id ?? null;
    return { ok: true, error: null, id };
  } catch (e) {
    if (e instanceof TradeInInputError) return { ok: false, error: e.message, id: null };
    console.error("buyFromCustomer error:", e);
    return { ok: false, error: "The phone could not be saved. Please try again.", id: null };
  }
}

export type QuickAddModelResult = {
  ok: boolean;
  error: string | null;
  modelId: string | null;
  variantId: string | null;
};

// Adds a phone model to the shared catalog from the model picker, or returns
// the existing one with the same brand, name and storage
export async function quickAddPhoneModel(input: unknown): Promise<QuickAddModelResult> {
  const fail = (error: string): QuickAddModelResult => ({ ok: false, error, modelId: null, variantId: null });
  try {
    const permissions = await getMyPermissions();
    if (!hasAny(permissions, [PERMISSION_TRADE_IN, "catalog.manage", "catalog.create"])) {
      return fail("You do not have permission to add phone models.");
    }
    if (typeof input !== "object" || input === null) return fail("The model details are not valid.");
    const raw = input as Record<string, unknown>;
    const brand = typeof raw.brand === "string" ? raw.brand.trim().replace(/\s+/g, " ") : "";
    const model = typeof raw.model === "string" ? raw.model.trim().replace(/\s+/g, " ") : "";
    if (!brand || brand.length > 60) return fail("Enter the brand (up to 60 characters).");
    if (!model || model.length > 100) return fail("Enter the model name (up to 100 characters).");
    const storage = raw.storage_gb;
    if (typeof storage !== "number" || !Number.isInteger(storage) || storage < 1 || storage > 4096) {
      return fail("Storage must be a whole number from 1 to 4096 GB.");
    }
    const ram = raw.ram_gb;
    if (ram !== null && ram !== undefined && (typeof ram !== "number" || !Number.isInteger(ram) || ram < 1 || ram > 64)) {
      return fail("RAM must be a whole number from 1 to 64 GB.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("quick_add_phone_model", {
      p_payload: { brand, model, storage_gb: storage, ram_gb: ram ?? null },
    });
    if (error) return fail(error.message);
    const result = data as { model_id?: string; variant_id?: string } | null;
    revalidatePath("/catalog", "layout");
    return { ok: true, error: null, modelId: result?.model_id ?? null, variantId: result?.variant_id ?? null };
  } catch (e) {
    console.error("quickAddPhoneModel error:", e);
    return fail("The model could not be added. Please try again.");
  }
}
