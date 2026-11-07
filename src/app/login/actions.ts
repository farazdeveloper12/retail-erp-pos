"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

export async function signIn(
  _previousState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Please enter both your email and password." };
  }

  const supabase = await createClient();

  // 1) Check email and password
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: "Incorrect email or password." };
  }

  // 2) Check the profile: it must exist and the account must be active
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) {
    await supabase.auth.signOut();
    return {
      error:
        "This account cannot be used. Please contact the owner.",
    };
  }

  redirect("/");
}