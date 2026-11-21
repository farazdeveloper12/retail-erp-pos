"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";

export type EntryResult = { ok: boolean; error: string | null };

export type EntryType =
  | "sale"
  | "purchase"
  | "expense"
  | "customer_payment"
  | "supplier_payment"
  | "customer_purchase"
  | "customer"
  | "supplier";

const TYPES = new Set<EntryType>([
  "sale",
  "purchase",
  "expense",
  "customer_payment",
  "supplier_payment",
  "customer_purchase",
  "customer",
  "supplier",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reasonOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= 3 && text.length <= 500 ? text : null;
}

// Pages that show money, stock or balances and must be fresh after a change
function refreshAll() {
  revalidatePath("/", "layout");
}

async function run(permission: string, rpc: string, payload: Record<string, unknown>): Promise<EntryResult> {
  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes(permission)) {
      return {
        ok: false,
        error:
          permission === "entries.edit"
            ? "You do not have permission to edit saved entries."
            : "You do not have permission to delete saved entries.",
      };
    }
    if (!reasonOf(payload.reason)) return { ok: false, error: "Write the reason (3 to 500 characters)." };
    const supabase = await createClient();
    const { error } = await supabase.rpc(rpc, { p_payload: payload });
    // The database raises clear English messages; show them as they are
    if (error) return { ok: false, error: error.message };
    refreshAll();
    return { ok: true, error: null };
  } catch (e) {
    console.error(`${rpc} error:`, e);
    return { ok: false, error: "The change could not be saved. Please try again." };
  }
}

export async function deleteEntry(type: unknown, id: unknown, reason: unknown): Promise<EntryResult> {
  if (typeof type !== "string" || !TYPES.has(type as EntryType)) return { ok: false, error: "Unknown entry." };
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Unknown entry." };
  return run("entries.delete", "delete_entry", { type, id, reason: reasonOf(reason) ?? reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The payloads are checked again in the database functions
export async function editSale(input: unknown): Promise<EntryResult> {
  if (!isRecord(input) || typeof input.sale_id !== "string" || !UUID.test(input.sale_id)) {
    return { ok: false, error: "Invoice not found." };
  }
  return run("entries.edit", "edit_sale", input);
}

export async function editPurchase(input: unknown): Promise<EntryResult> {
  if (!isRecord(input) || typeof input.purchase_id !== "string" || !UUID.test(input.purchase_id)) {
    return { ok: false, error: "Purchase not found." };
  }
  return run("entries.edit", "edit_purchase", input);
}

export async function editExpense(input: unknown): Promise<EntryResult> {
  if (!isRecord(input) || typeof input.expense_id !== "string" || !UUID.test(input.expense_id)) {
    return { ok: false, error: "Expense not found." };
  }
  return run("entries.edit", "edit_expense", input);
}

export async function editPayment(input: unknown): Promise<EntryResult> {
  if (
    !isRecord(input) ||
    (input.kind !== "customer" && input.kind !== "supplier") ||
    typeof input.payment_id !== "string" ||
    !UUID.test(input.payment_id)
  ) {
    return { ok: false, error: "Payment not found." };
  }
  return run("entries.edit", "edit_payment", input);
}

export async function editCustomerPurchase(input: unknown): Promise<EntryResult> {
  if (!isRecord(input) || typeof input.id !== "string" || !UUID.test(input.id)) {
    return { ok: false, error: "Not found." };
  }
  return run("entries.edit", "edit_customer_purchase", input);
}
