"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AccountState = { error: string | null; success: string | null };

const fail = (error: string): AccountState => ({ error, success: null });

export async function updateMyName(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const name = String(formData.get("full_name") ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return fail("Your name must be between 2 and 80 characters.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", { p_full_name: name });
  if (error) return fail(error.message);

  // The name is shown in the top bar on every page
  revalidatePath("/", "layout");
  return { error: null, success: "Your name has been saved." };
}

export async function changeMyPassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!current) return fail("Enter your current password.");
  if (next.length < 12) return fail("The new password must be at least 12 characters long.");
  if (next.length > 72) return fail("The new password cannot be longer than 72 characters.");
  if (next !== confirm) return fail("The two new passwords do not match.");
  if (next === current) return fail("The new password must be different from the current one.");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = typeof claims?.claims?.email === "string" ? claims.claims.email : null;
  if (!email) return fail("You are not signed in.");

  // Confirm the current password before changing it
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: current });
  if (signInError) return fail("Your current password is not correct.");

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return fail(`The password could not be changed. ${error.message}`);

  return { error: null, success: "Your password has been changed." };
}
