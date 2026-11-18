"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";

export type SettingsState = {
  error: string | null;
  success: string | null;
  values?: Record<string, string>;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCIES = new Set(["PKR", "AED"]);

const FIELDS = [
  "name",
  "legal_name",
  "currency_code",
  "phone",
  "email",
  "address",
] as const;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function updateBusinessSettings(
  _previousState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const values: Record<string, string> = {};
  for (const field of FIELDS) values[field] = text(formData, field);
  values.currency_code = values.currency_code.toUpperCase();

  const fail = (error: string): SettingsState => ({
    error,
    success: null,
    values,
  });

  // 1) Check permission on the server
  const supabase = await createClient();
  const { data: allowed, error: permError } = await supabase.rpc(
    "has_permission",
    { perm: "settings.manage" }
  );
  if (permError || allowed !== true) {
    return fail("You do not have permission to change business settings.");
  }

  // 2) Validate the input
  if (values.name === "") return fail("Business name is required.");
  if (values.name.length > 120) {
    return fail("Business name cannot be longer than 120 characters.");
  }
  if (values.legal_name.length > 160) {
    return fail("Legal name cannot be longer than 160 characters.");
  }
  if (!CURRENCIES.has(values.currency_code)) {
    return fail("Choose PKR or AED as the currency.");
  }
  if (values.phone.length > 40) {
    return fail("Phone cannot be longer than 40 characters.");
  }
  if (values.email !== "" && !EMAIL_PATTERN.test(values.email)) {
    return fail("Please enter a valid email address.");
  }
  if (values.address.length > 300) {
    return fail("Address cannot be longer than 300 characters.");
  }

  // 3) Find the user's business on the server (never trust the browser)
  const business = await getMyBusiness();
  if (!business) {
    return fail("No business is linked to your account.");
  }

  // 4) Update through the normal client so RLS decides
  const { data, error } = await supabase
    .from("businesses")
    .update({
      name: values.name,
      legal_name: values.legal_name || null,
      currency_code: values.currency_code,
      phone: values.phone || null,
      email: values.email || null,
      address: values.address || null,
    })
    .eq("id", business.id)
    .select("id");

  if (error) {
    if (error.code === "42501") {
      return fail("You do not have permission to change business settings.");
    }
    return fail("The settings could not be saved: " + error.message);
  }
  if (!data || data.length === 0) {
    return fail("The settings could not be saved. Please check your permissions.");
  }

  // Refresh every page so the sidebar and tab title show the new name
  revalidatePath("/", "layout");

  return { error: null, success: "Business settings saved.", values };
}
