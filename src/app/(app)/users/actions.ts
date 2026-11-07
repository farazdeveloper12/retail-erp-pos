"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateUserState = {
  error: string | null;
  success: string | null;
  values: { full_name: string; email: string; role: string };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createEmployee(
  _previousState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  // The password is never sent back to the form
  const values = { full_name: fullName, email, role };
  const fail = (error: string): CreateUserState => ({
    error,
    success: null,
    values,
  });

  // 1) Check permission on the server
  const supabase = await createClient();
  const { data: allowed, error: permError } = await supabase.rpc(
    "has_permission",
    { perm: "users.manage" }
  );
  if (permError || allowed !== true) {
    return fail("You do not have permission to create users.");
  }

  // 2) Validate the input
  if (fullName.length < 2 || fullName.length > 80) {
    return fail("Name must be between 2 and 80 characters.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    return fail("Please enter a valid email address.");
  }
  if (role !== "manager" && role !== "sales") {
    return fail("Please choose either Manager or Sales Employee.");
  }
  if (password.length < 12) {
    return fail("Password must be at least 12 characters long.");
  }
  if (password !== confirmPassword) {
    return fail("The two passwords do not match.");
  }

  // 3) Read the creator's business on the server (never from the browser).
  //    The new employee joins the same business.
  const { data: businessId, error: businessError } =
    await supabase.rpc("my_business_id");
  if (businessError || typeof businessId !== "string" || businessId === "") {
    return fail(
      "Your account is not linked to a business, so employees cannot be created."
    );
  }

  // 4) Create the account
  const admin = createAdminClient();
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    const message = createError?.message ?? "";
    if (createError?.code === "email_exists" || /already/i.test(message)) {
      return fail("An account with this email already exists.");
    }
    return fail(
      "The account could not be created: " + (message || "unknown reason")
    );
  }

  // 5) Create the profile in the creator's business.
  //    If that fails, remove the new account again.
  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: fullName,
    role,
    business_id: businessId,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(
      "The profile could not be created, so the account was removed: " +
        profileError.message
    );
  }

  revalidatePath("/users");

  return {
    error: null,
    success: `Account created for ${fullName}. They can now sign in with this email and password.`,
    values: { full_name: "", email: "", role: "sales" },
  };
}
