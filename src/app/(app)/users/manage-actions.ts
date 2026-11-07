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

// Activate or deactivate an account
export async function updateUserStatus(
  _previousState: ManageState,
  formData: FormData
): Promise<ManageState> {
  const userId = readUserId(formData);
  if (!userId) return fail("Invalid user ID.");

  const makeActive = String(formData.get("active")) === "true";

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_active", {
    target: userId,
    make_active: makeActive,
  });
  if (error) return fail(error.message);

  return ok(
    makeActive ? "The account has been activated." : "The account has been deactivated."
  );
}

// Change the role
export async function updateUserRole(
  _previousState: ManageState,
  formData: FormData
): Promise<ManageState> {
  const userId = readUserId(formData);
  if (!userId) return fail("Invalid user ID.");

  const role = String(formData.get("role") ?? "");
  if (role !== "manager" && role !== "sales") {
    return fail("Please choose either Manager or Sales Employee.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    target: userId,
    new_role: role,
  });
  if (error) return fail(error.message);

  return ok("The role has been updated.");
}

// Save permission overrides
export async function saveUserPermissions(
  _previousState: ManageState,
  formData: FormData
): Promise<ManageState> {
  const userId = readUserId(formData);
  if (!userId) return fail("Invalid user ID.");

  const changes: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("perm:")) continue;
    const mode = String(value);
    if (!MODES.has(mode)) return fail("Invalid option selected.");
    changes[name.slice(5)] = mode;
  }

  if (Object.keys(changes).length === 0) {
    return fail("No permissions were submitted.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_permissions", {
    target: userId,
    changes,
  });
  if (error) return fail(error.message);

  return ok("Permissions saved.");
}
