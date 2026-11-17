"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

export type ReturnResult = {
  ok: boolean;
  error: string | null;
  id?: string;
  data?: Record<string, unknown> | null;
};

const fail = (error: string): ReturnResult => ({ ok: false, error });
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLAIM_STATUSES = new Set(["sent_out", "repaired", "replaced", "rejected", "returned"]);

function asRecord(input: unknown) {
  return (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max + 1) : "";
}

async function can(permission: string) {
  return (await getMyPermissions()).includes(permission);
}

async function rpc(name: string, payload: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, { p_payload: payload });
  // The database raises clear English messages; show them as they are
  return { data: (data ?? null) as Record<string, unknown> | null, error: error?.message ?? null };
}

function refreshAfterMoney() {
  revalidatePath("/returns", "layout");
  revalidatePath("/sales", "layout");
  revalidatePath("/purchases", "layout");
  revalidatePath("/finance", "layout");
  revalidatePath("/inventory");
  revalidatePath("/customers", "layout");
  revalidatePath("/suppliers", "layout");
  revalidatePath("/");
}

// ---------- Sales returns ----------

type SalesReturnItem = { sale_item_id: string; quantity: number; restock: boolean };

function readSalesItems(value: unknown): SalesReturnItem[] | string {
  if (!Array.isArray(value) || value.length === 0) return "Choose at least one item to return.";
  if (value.length > 200) return "Too many items in one return.";
  const items: SalesReturnItem[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    const id = typeof row.sale_item_id === "string" ? row.sale_item_id : "";
    const quantity = row.quantity;
    if (!UUID_PATTERN.test(id)) return "An item in the return is not valid.";
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      return "Enter a whole quantity of at least 1.";
    }
    items.push({ sale_item_id: id, quantity, restock: row.restock !== false });
  }
  return items;
}

export async function previewSalesReturn(input: unknown): Promise<ReturnResult> {
  try {
    if (!(await can("returns.manage"))) return fail("You do not have permission to record returns.");
    const raw = asRecord(input);
    const saleId = typeof raw.sale_id === "string" ? raw.sale_id : "";
    if (!UUID_PATTERN.test(saleId)) return fail("Invoice not found.");
    const items = readSalesItems(raw.items);
    if (typeof items === "string") return fail(items);
    const { data, error } = await rpc("preview_sales_return", { sale_id: saleId, items });
    if (error) return fail(error);
    return { ok: true, error: null, data };
  } catch (e) {
    console.error("previewSalesReturn error:", e);
    return fail("The return could not be checked. Please try again.");
  }
}

export async function createSalesReturn(input: unknown): Promise<ReturnResult> {
  try {
    if (!(await can("returns.manage"))) return fail("You do not have permission to record returns.");
    const raw = asRecord(input);
    const saleId = typeof raw.sale_id === "string" ? raw.sale_id : "";
    if (!UUID_PATTERN.test(saleId)) return fail("Invoice not found.");
    const items = readSalesItems(raw.items);
    if (typeof items === "string") return fail(items);
    const reason = text(raw.reason, 300);
    if (!reason || reason.length > 300) return fail("Write the reason for the return (up to 300 characters).");
    const notes = text(raw.notes, 500);
    if (notes.length > 500) return fail("The note cannot be longer than 500 characters.");
    const date = text(raw.return_date, 10);
    if (date && !DATE_PATTERN.test(date)) return fail("The date is not valid.");
    const account = typeof raw.refund_account_id === "string" ? raw.refund_account_id : "";
    if (account && !UUID_PATTERN.test(account)) return fail("The account is not valid.");

    const { data, error } = await rpc("create_sales_return", {
      sale_id: saleId,
      items,
      reason,
      notes: notes || null,
      return_date: date || null,
      refund_account_id: account || null,
    });
    if (error) return fail(error);
    refreshAfterMoney();
    return { ok: true, error: null, id: String(data?.return_id ?? ""), data };
  } catch (e) {
    console.error("createSalesReturn error:", e);
    return fail("The return could not be saved. Please try again.");
  }
}

// ---------- Purchase returns ----------

export async function createPurchaseReturn(input: unknown): Promise<ReturnResult> {
  try {
    if (!(await can("purchases.manage"))) return fail("You do not have permission to return items to suppliers.");
    const raw = asRecord(input);
    const purchaseId = typeof raw.purchase_id === "string" ? raw.purchase_id : "";
    if (!UUID_PATTERN.test(purchaseId)) return fail("Purchase not found.");

    const phoneIds = Array.isArray(raw.phone_unit_ids) ? raw.phone_unit_ids : [];
    if (phoneIds.length > 500 || !phoneIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))) {
      return fail("A phone in the return is not valid.");
    }
    const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
    if (itemsRaw.length > 200) return fail("Too many items in one return.");
    const items: { purchase_item_id: string; quantity: number }[] = [];
    for (const value of itemsRaw) {
      const row = asRecord(value);
      const id = typeof row.purchase_item_id === "string" ? row.purchase_item_id : "";
      const quantity = row.quantity;
      if (!UUID_PATTERN.test(id)) return fail("An item in the return is not valid.");
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
        return fail("Enter a whole quantity of at least 1.");
      }
      items.push({ purchase_item_id: id, quantity });
    }
    if (phoneIds.length + items.length === 0) return fail("Choose at least one item to return.");

    const reason = text(raw.reason, 300);
    if (!reason || reason.length > 300) return fail("Write the reason for the return (up to 300 characters).");
    const notes = text(raw.notes, 500);
    if (notes.length > 500) return fail("The note cannot be longer than 500 characters.");
    const date = text(raw.return_date, 10);
    if (date && !DATE_PATTERN.test(date)) return fail("The date is not valid.");
    const account = typeof raw.refund_account_id === "string" ? raw.refund_account_id : "";
    if (account && !UUID_PATTERN.test(account)) return fail("The account is not valid.");

    const { data, error } = await rpc("create_purchase_return", {
      purchase_id: purchaseId,
      phone_unit_ids: phoneIds,
      items,
      reason,
      notes: notes || null,
      return_date: date || null,
      refund_account_id: account || null,
    });
    if (error) return fail(error);
    refreshAfterMoney();
    return { ok: true, error: null, id: String(data?.return_id ?? ""), data };
  } catch (e) {
    console.error("createPurchaseReturn error:", e);
    return fail("The return could not be saved. Please try again.");
  }
}

// ---------- Warranty claims ----------

export async function createWarrantyClaim(input: unknown): Promise<ReturnResult> {
  try {
    if (!(await can("returns.manage"))) return fail("You do not have permission to record warranty claims.");
    const raw = asRecord(input);
    const saleItemId = typeof raw.sale_item_id === "string" ? raw.sale_item_id : "";
    if (saleItemId && !UUID_PATTERN.test(saleItemId)) return fail("The sold item is not valid.");
    const issue = text(raw.issue, 1000);
    if (!issue || issue.length > 1000) return fail("Describe the problem (up to 1000 characters).");
    const description = text(raw.item_description, 200);
    if (!saleItemId && (!description || description.length > 200)) {
      return fail("Describe the item (up to 200 characters).");
    }
    const imei = text(raw.imei, 20).replace(/\s/g, "");
    if (imei && !/^\d{15}$/.test(imei)) return fail("The IMEI must be 15 digits.");
    const name = text(raw.customer_name, 120);
    const phone = text(raw.customer_phone, 30);
    if (name.length > 120) return fail("The customer name cannot be longer than 120 characters.");
    if (phone.length > 30) return fail("The phone number cannot be longer than 30 characters.");
    const date = text(raw.received_on, 10);
    if (date && !DATE_PATTERN.test(date)) return fail("The date is not valid.");

    const { data, error } = await rpc("create_warranty_claim", {
      sale_item_id: saleItemId || null,
      item_description: description || null,
      imei: imei || null,
      customer_name: name || null,
      customer_phone: phone || null,
      issue,
      received_on: date || null,
    });
    if (error) return fail(error);
    revalidatePath("/returns", "layout");
    return { ok: true, error: null, id: String(data?.claim_id ?? ""), data };
  } catch (e) {
    console.error("createWarrantyClaim error:", e);
    return fail("The claim could not be saved. Please try again.");
  }
}

export async function updateWarrantyClaim(input: unknown): Promise<ReturnResult> {
  try {
    if (!(await can("returns.manage"))) return fail("You do not have permission to update warranty claims.");
    const raw = asRecord(input);
    const claimId = typeof raw.claim_id === "string" ? raw.claim_id : "";
    if (!UUID_PATTERN.test(claimId)) return fail("The claim is not valid.");
    const status = typeof raw.status === "string" ? raw.status : "";
    if (!CLAIM_STATUSES.has(status)) return fail("Choose the new status.");
    const note = text(raw.note, 500);
    if (note.length > 500) return fail("The note cannot be longer than 500 characters.");
    const sentTo = text(raw.sent_to, 120);
    if (sentTo.length > 120) return fail("Write where the item was sent (up to 120 characters).");
    const supplierId = typeof raw.supplier_id === "string" ? raw.supplier_id : "";
    if (supplierId && !UUID_PATTERN.test(supplierId)) return fail("The supplier is not valid.");
    if (status === "sent_out" && !sentTo && !supplierId) return fail("Write where the item was sent.");
    const date = text(raw.event_date, 10);
    if (date && !DATE_PATTERN.test(date)) return fail("The date is not valid.");

    const { error } = await rpc("update_warranty_claim", {
      claim_id: claimId,
      status,
      note: note || null,
      sent_to: sentTo || null,
      supplier_id: supplierId || null,
      event_date: date || null,
    });
    if (error) return fail(error);
    revalidatePath("/returns", "layout");
    return { ok: true, error: null, id: claimId };
  } catch (e) {
    console.error("updateWarrantyClaim error:", e);
    return fail("The claim could not be updated. Please try again.");
  }
}
