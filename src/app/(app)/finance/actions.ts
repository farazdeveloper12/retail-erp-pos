"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { cleanMoneyInput } from "@/lib/money";

export type FinanceResult = { ok: boolean; error: string | null; message?: string | null };

const fail = (error: string): FinanceResult => ({ ok: false, error });
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const SIGNED_AMOUNT_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
const MANUAL_TYPES = new Set([
  "deposit",
  "withdrawal",
  "transfer",
  "owner_capital_in",
  "owner_capital_out",
  "adjustment",
]);

function asRecord(input: unknown) {
  return (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max + 1) : "";
}

async function canManage() {
  const permissions = await getMyPermissions();
  return permissions.includes("finance.manage");
}

function refresh() {
  revalidatePath("/finance", "layout");
  // The dashboard shows cash and bank balances
  revalidatePath("/");
}

async function callRpc(name: string, payload: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, { p_payload: payload });
  // The database raises clear English messages; show them as they are
  return { data: data as Record<string, unknown> | null, error: error?.message ?? null };
}

// ---------- Accounts ----------

export async function createAccount(input: unknown): Promise<FinanceResult> {
  try {
    if (!(await canManage())) return fail("You do not have permission to manage accounts.");
    const raw = asRecord(input);
    const name = text(raw.name, 60).replace(/\s+/g, " ");
    if (name.length < 1 || name.length > 60) return fail("The account name must be 1 to 60 characters.");
    const kind = raw.kind;
    if (kind !== "cash" && kind !== "bank" && kind !== "wallet") return fail("Choose cash, bank or wallet.");
    const details = text(raw.details, 200);
    if (details.length > 200) return fail("The details cannot be longer than 200 characters.");
    const opening = cleanMoneyInput(typeof raw.opening_balance === "string" ? raw.opening_balance : "");
    if (opening && !SIGNED_AMOUNT_PATTERN.test(opening)) {
      return fail("The opening balance must be a number with up to 2 decimals.");
    }
    const openingDate = text(raw.opening_date, 10);
    if (openingDate && !DATE_PATTERN.test(openingDate)) return fail("The opening date is not valid.");

    const { error } = await callRpc("create_finance_account", {
      name,
      kind,
      details: details || null,
      opening_balance: opening || "0",
      opening_date: openingDate || null,
    });
    if (error) return fail(error);
    refresh();
    return { ok: true, error: null, message: `${name} added.` };
  } catch (e) {
    console.error("createAccount error:", e);
    return fail("The account could not be saved. Please try again.");
  }
}

export async function updateAccount(input: unknown): Promise<FinanceResult> {
  try {
    if (!(await canManage())) return fail("You do not have permission to manage accounts.");
    const raw = asRecord(input);
    const id = typeof raw.account_id === "string" ? raw.account_id : "";
    if (!UUID_PATTERN.test(id)) return fail("The account is not valid.");

    const payload: Record<string, unknown> = { account_id: id };
    if ("name" in raw) {
      const name = text(raw.name, 60).replace(/\s+/g, " ");
      if (name.length < 1 || name.length > 60) return fail("The account name must be 1 to 60 characters.");
      payload.name = name;
    }
    if ("details" in raw) {
      const details = text(raw.details, 200);
      if (details.length > 200) return fail("The details cannot be longer than 200 characters.");
      payload.details = details || null;
    }
    if ("opening_balance" in raw) {
      const opening = cleanMoneyInput(typeof raw.opening_balance === "string" ? raw.opening_balance : "") || "0";
      if (!SIGNED_AMOUNT_PATTERN.test(opening)) {
        return fail("The opening balance must be a number with up to 2 decimals.");
      }
      payload.opening_balance = opening;
    }
    if ("opening_date" in raw) {
      const date = text(raw.opening_date, 10);
      if (!DATE_PATTERN.test(date)) return fail("The opening date is not valid.");
      payload.opening_date = date;
    }
    if ("is_active" in raw) {
      if (typeof raw.is_active !== "boolean") return fail("The status is not valid.");
      payload.is_active = raw.is_active;
    }
    if (raw.make_default === true) payload.make_default = true;

    const { error } = await callRpc("update_finance_account", payload);
    if (error) return fail(error);
    refresh();
    return { ok: true, error: null, message: "Account saved." };
  } catch (e) {
    console.error("updateAccount error:", e);
    return fail("The account could not be saved. Please try again.");
  }
}

// ---------- Manual entries ----------

export async function recordEntry(input: unknown): Promise<FinanceResult> {
  try {
    if (!(await canManage())) return fail("You do not have permission to record entries.");
    const raw = asRecord(input);
    const type = typeof raw.type === "string" ? raw.type : "";
    if (!MANUAL_TYPES.has(type)) return fail("Choose the type of entry.");
    const accountId = typeof raw.account_id === "string" ? raw.account_id : "";
    if (!UUID_PATTERN.test(accountId)) return fail("Choose an account.");
    const amount = cleanMoneyInput(typeof raw.amount === "string" ? raw.amount : "");
    if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
      return fail("Enter an amount above zero with up to 2 decimals.");
    }
    const date = text(raw.entry_date, 10);
    if (date && !DATE_PATTERN.test(date)) return fail("The date is not valid.");
    const notes = text(raw.notes, 500);
    if (notes.length > 500) return fail("The note cannot be longer than 500 characters.");
    if (type === "adjustment" && !notes) return fail("Write a short note that explains the adjustment.");

    const payload: Record<string, unknown> = {
      type,
      account_id: accountId,
      amount,
      entry_date: date || null,
      notes: notes || null,
    };
    if (type === "transfer") {
      const to = typeof raw.to_account_id === "string" ? raw.to_account_id : "";
      if (!UUID_PATTERN.test(to)) return fail("Choose the account the money goes to.");
      if (to === accountId) return fail("Choose two different accounts for a transfer.");
      payload.to_account_id = to;
    }
    if (type === "adjustment") {
      if (raw.direction !== "in" && raw.direction !== "out") {
        return fail("Choose whether the adjustment adds or removes money.");
      }
      payload.direction = raw.direction;
    }

    const { error } = await callRpc("record_finance_entry", payload);
    if (error) return fail(error);
    refresh();
    return { ok: true, error: null, message: "Entry saved." };
  } catch (e) {
    console.error("recordEntry error:", e);
    return fail("The entry could not be saved. Please try again.");
  }
}

export async function cancelEntry(input: unknown): Promise<FinanceResult> {
  try {
    if (!(await canManage())) return fail("You do not have permission to cancel entries.");
    const raw = asRecord(input);
    const id = typeof raw.entry_id === "string" ? raw.entry_id : "";
    if (!UUID_PATTERN.test(id)) return fail("The entry is not valid.");
    const reason = text(raw.reason, 300);
    if (reason.length > 300) return fail("The reason cannot be longer than 300 characters.");

    const { error } = await callRpc("void_finance_entry", { entry_id: id, reason: reason || null });
    if (error) return fail(error);
    refresh();
    return { ok: true, error: null, message: "Entry cancelled." };
  } catch (e) {
    console.error("cancelEntry error:", e);
    return fail("The entry could not be cancelled. Please try again.");
  }
}

// ---------- Cash count ----------

export async function recordCount(input: unknown): Promise<FinanceResult> {
  try {
    if (!(await canManage())) return fail("You do not have permission to record a count.");
    const raw = asRecord(input);
    const accountId = typeof raw.account_id === "string" ? raw.account_id : "";
    if (!UUID_PATTERN.test(accountId)) return fail("Choose an account.");
    const counted = cleanMoneyInput(typeof raw.counted_amount === "string" ? raw.counted_amount : "");
    if (!AMOUNT_PATTERN.test(counted)) return fail("The counted amount must be 0 or more with up to 2 decimals.");
    const notes = text(raw.notes, 500);
    if (notes.length > 500) return fail("The note cannot be longer than 500 characters.");

    const { error } = await callRpc("record_finance_count", {
      account_id: accountId,
      counted_amount: counted,
      notes: notes || null,
      post_adjustment: raw.post_adjustment === true,
    });
    if (error) return fail(error);
    refresh();
    return { ok: true, error: null, message: "Count saved." };
  } catch (e) {
    console.error("recordCount error:", e);
    return fail("The count could not be saved. Please try again.");
  }
}
