"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ManageState = { error: string | null; success: string | null };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MODES = new Set(["default", "allow", "deny"]);

function readUserId(formData: FormData): string | null {
  const id = String(formData.get("user_id") ?? "");
  return UUID_PATTERN.test(id) ? id : null;
}

function fail(message: string): ManageState {
  return { error: message, success: null };
}

function ok(message: string): ManageState {
  revalidatePath("/users");
  revalidatePath("/users/manage");
  return { error: null, success: message };
}

// Account band ya chalu karna
export async function updateUserStatus(
  _previousState: ManageState,
  formData: FormData
): Promise<ManageState> {
  const userId = readUserId(formData);
  if (!userId) return fail("User ki pehchaan ghalat hai.");

  const makeActive = String(formData.get("active")) === "true";

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_active", {
    target: userId,
    make_active: makeActive,
  });
  if (error) return fail(error.message);

  return ok(
    makeActive
      ? "Account chalu kar diya gaya."
      : "Account band kar diya gaya."
  );
}

// Role badalna
export async function updateUserRole(
  _previousState: ManageState,
  formData: FormData
): Promise<ManageState> {
  const userId = readUserId(formData);
  if (!userId) return fail("User ki pehchaan ghalat hai.");

  const role = String(formData.get("role") ?? "");
  if (role !== "manager" && role !== "sales") {
    return fail("Role Manager ya Sales Employee chunein.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    target: userId,
    new_role: role,
  });
  if (error) return fail(error.message);

  return ok("Role badal diya gaya.");
}

// Ijazatein save karna
export async function saveUserPermissions(
  _previousState: ManageState,
  formData: FormData
): Promise<ManageState> {
  const userId = readUserId(formData);
  if (!userId) return fail("User ki pehchaan ghalat hai.");

  const changes: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("perm:")) continue;
    const mode = String(value);
    if (!MODES.has(mode)) return fail("Ghalat chunav mila.");
    changes[name.slice(5)] = mode;
  }

  if (Object.keys(changes).length === 0) {
    return fail("Koi ijazat nahi mili.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_permissions", {
    target: userId,
    changes,
  });
  if (error) return fail(error.message);

  return ok("Ijazatein save ho gayin.");
}