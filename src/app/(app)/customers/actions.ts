"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

export type CustomerFormState = {
  error: string | null;
  success: string | null;
  values?: Record<string, string>;
};

// Trim and collapse repeated spaces
function normalize(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function multiline(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

type Fields = { name: string; phone: string; address: string; notes: string };

function readFields(formData: FormData): Fields {
  return {
    name: normalize(formData.get("name")),
    phone: normalize(formData.get("phone")),
    address: multiline(formData.get("address")),
    notes: multiline(formData.get("notes")),
  };
}

function validate(fields: Fields): string | null {
  if (fields.name.length < 1) return "Customer name is required.";
  if (fields.name.length > 120) return "Customer name cannot be longer than 120 characters.";
  if (fields.phone.length < 1) return "Phone is required.";
  if (fields.phone.length > 40) return "Phone cannot be longer than 40 characters.";
  if (fields.address.length > 300) return "Address cannot be longer than 300 characters.";
  if (fields.notes.length > 1000) return "Notes cannot be longer than 1000 characters.";
  return null;
}

function friendlyError(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === "23505") return "A customer with this phone number already exists.";
  if (error.code === "42501") return "You do not have permission to do this.";
  return `${fallback} ${error.message}`;
}

function revalidateCustomers(id?: string) {
  revalidatePath("/customers");
  if (id) revalidatePath(`/customers/${id}`);
}

export async function createCustomer(
  _previousState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const fields = readFields(formData);
  const fail = (error: string): CustomerFormState => ({ error, success: null, values: fields });

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, ["customers.create", "customers.manage"])) {
    return fail("You do not have permission to add customers.");
  }
  const invalid = validate(fields);
  if (invalid) return fail(invalid);

  // business_id and created_by come from the database defaults
  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    name: fields.name,
    phone: fields.phone,
    address: fields.address || null,
    notes: fields.notes || null,
  });
  if (error) return fail(friendlyError(error, "The customer could not be saved."));

  revalidateCustomers();
  return { error: null, success: `"${fields.name}" has been added.`, values: {} };
}

export async function updateCustomer(
  _previousState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const fields = readFields(formData);
  const fail = (error: string): CustomerFormState => ({ error, success: null, values: fields });

  const permissions = await getMyPermissions();
  if (!permissions.includes("customers.manage")) {
    return fail("You do not have permission to edit customers.");
  }
  const customerId = String(formData.get("customer_id") ?? "");
  if (!UUID_PATTERN.test(customerId)) return fail("Invalid customer ID.");
  const invalid = validate(fields);
  if (invalid) return fail(invalid);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({
      name: fields.name,
      phone: fields.phone,
      address: fields.address || null,
      notes: fields.notes || null,
    })
    .eq("id", customerId)
    .select("id");
  if (error) return fail(friendlyError(error, "The customer could not be saved."));
  if (!data || data.length === 0) {
    return fail("The customer could not be saved. Please check your permissions.");
  }

  revalidateCustomers(customerId);
  return { error: null, success: "Customer saved.", values: fields };
}

export async function setCustomerActive(
  _previousState: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const fail = (error: string): CustomerFormState => ({ error, success: null });

  const permissions = await getMyPermissions();
  if (!permissions.includes("customers.manage")) {
    return fail("You do not have permission to change customers.");
  }
  const customerId = String(formData.get("customer_id") ?? "");
  if (!UUID_PATTERN.test(customerId)) return fail("Invalid customer ID.");
  const active = String(formData.get("active")) === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ is_active: active })
    .eq("id", customerId)
    .select("id");
  if (error) return fail(friendlyError(error, "The change could not be saved."));
  if (!data || data.length === 0) {
    return fail("The change could not be saved. Please check your permissions.");
  }

  revalidateCustomers(customerId);
  return { error: null, success: active ? "Activated." : "Deactivated." };
}
