"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

export type RecordExpenseResult = {
  ok: boolean;
  error: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 1_000_000_000_000;

// Saves one expense through the database function
export async function recordExpense(input: unknown): Promise<RecordExpenseResult> {
  const fail = (error: string): RecordExpenseResult => ({ ok: false, error });

  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes("expenses.manage")) {
      return fail("You do not have permission to record expenses.");
    }

    const raw = (typeof input === "object" && input !== null ? input : {}) as Record<
      string,
      unknown
    >;

    const date = typeof raw.expense_date === "string" ? raw.expense_date.trim() : "";
    if (date && !DATE_PATTERN.test(date)) return fail("The date is not valid.");

    const category =
      typeof raw.category === "string" ? raw.category.trim().replace(/\s+/g, " ") : "";
    if (!category) return fail("Category is required.");
    if (category.length > 60) return fail("Category cannot be longer than 60 characters.");

    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    if (description.length > 500) return fail("Description cannot be longer than 500 characters.");

    const amount = raw.amount;
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_AMOUNT ||
      Math.round(amount * 100) / 100 !== amount
    ) {
      return fail("Enter an amount above zero with up to 2 decimals.");
    }

    const method = raw.payment_method;
    if (method !== "cash" && method !== "bank") {
      return fail("Choose Cash or Bank.");
    }

    const payload: Record<string, unknown> = {
      category,
      description: description || null,
      amount,
      payment_method: method,
    };
    if (date) payload.expense_date = date;

    const supabase = await createClient();
    const { error } = await supabase.rpc("record_expense", { p_payload: payload });
    if (error) {
      // The database raises clear English messages; show them as they are
      return fail(error.message);
    }

    revalidatePath("/expenses");
    return { ok: true, error: null };
  } catch (e) {
    console.error("recordExpense error:", e);
    return fail("The expense could not be saved. Please try again.");
  }
}

// Cancels an expense. The database keeps the record and adds a reversing
// cash or bank entry, so nothing is deleted.
export async function voidExpense(expenseId: unknown): Promise<RecordExpenseResult> {
  const fail = (error: string): RecordExpenseResult => ({ ok: false, error });

  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes("expenses.manage")) {
      return fail("You do not have permission to cancel expenses.");
    }
    if (typeof expenseId !== "string" || !UUID_PATTERN.test(expenseId)) {
      return fail("The expense is not valid.");
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc("void_expense", {
      p_payload: { expense_id: expenseId },
    });
    if (error) {
      // The database raises clear English messages; show them as they are
      return fail(error.message);
    }

    revalidatePath("/expenses");
    return { ok: true, error: null };
  } catch (e) {
    console.error("voidExpense error:", e);
    return fail("The expense could not be cancelled. Please try again.");
  }
}
