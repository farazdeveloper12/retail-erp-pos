"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

type Db = Awaited<ReturnType<typeof createClient>>;

export type SupplierOption = {
  id: string;
  name: string;
  phone: string | null;
};

export type CreateSupplierResult = {
  ok: boolean;
  error: string | null;
  message: string | null;
  existing: boolean;
  supplier: SupplierOption | null;
};

export type SupplierFormState = {
  error: string | null;
  success: string | null;
};

// Same rules as the database policies for suppliers
const READ_PERMISSIONS = [
  "suppliers.view",
  "suppliers.manage",
  "purchases.view",
  "purchases.manage",
];
const CREATE_PERMISSIONS = ["suppliers.manage", "purchases.manage"];
const MANAGE_PERMISSIONS = ["suppliers.manage"];

const SUPPLIERS_PATH = "/suppliers";

// Trim and collapse repeated spaces: "  Ali   Traders " -> "Ali Traders"
function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function multiline(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Characters that act as wildcards in ilike filters are removed for searches
function cleanSearch(value: string): string {
  return value.replace(/[%_*\\,()]/g, " ").replace(/\s+/g, " ").trim();
}

function sameName(a: string, b: string) {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

type Fields = {
  name: string;
  phone: string;
  address: string;
  notes: string;
};

function validate(fields: Fields): string | null {
  if (fields.name.length < 1) return "Supplier name is required.";
  if (fields.name.length > 120) {
    return "Supplier name cannot be longer than 120 characters.";
  }
  if (fields.phone.length > 40) {
    return "Phone cannot be longer than 40 characters.";
  }
  if (fields.address.length > 300) {
    return "Address cannot be longer than 300 characters.";
  }
  if (fields.notes.length > 1000) {
    return "Notes cannot be longer than 1000 characters.";
  }
  return null;
}

function friendlyError(
  error: { code?: string; message: string },
  fallback: string
): string {
  if (error.code === "23505") return "A supplier with this name already exists.";
  if (error.code === "42501") return "You do not have permission to do this.";
  return fallback + " " + error.message;
}

// Finds an existing supplier by name (case and space insensitive)
async function findSupplierByName(
  supabase: Db,
  name: string
): Promise<SupplierOption | null> {
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, phone")
    .ilike("name", cleanSearch(name))
    .limit(10);
  // ilike may still match more loosely, so compare exactly here
  const match = (data ?? []).find((row) => sameName(row.name, name));
  return match ? { id: match.id, name: match.name, phone: match.phone } : null;
}

export async function createSupplier(
  input: unknown
): Promise<CreateSupplierResult> {
  const result = (
    partial: Partial<CreateSupplierResult>
  ): CreateSupplierResult => ({
    ok: false,
    error: null,
    message: null,
    existing: false,
    supplier: null,
    ...partial,
  });

  const raw = (typeof input === "object" && input !== null ? input : {}) as
    Record<string, unknown>;
  const fields: Fields = {
    name: normalize(raw.name),
    phone: normalize(raw.phone),
    address: multiline(raw.address),
    notes: multiline(raw.notes),
  };

  // 1) Permission check on the server
  const permissions = await getMyPermissions();
  if (!hasAny(permissions, CREATE_PERMISSIONS)) {
    return result({ error: "You do not have permission to add suppliers." });
  }

  // 2) Validate
  const invalid = validate(fields);
  if (invalid) return result({ error: invalid });

  const supabase = await createClient();

  // 3) Same name already exists? Return it instead of failing.
  const existing = await findSupplierByName(supabase, fields.name);
  if (existing) {
    return result({
      ok: true,
      existing: true,
      supplier: existing,
      message: "This supplier already exists.",
    });
  }

  // 4) Create. business_id and created_by come from the database.
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: fields.name,
      phone: fields.phone || null,
      address: fields.address || null,
      notes: fields.notes || null,
    })
    .select("id, name, phone")
    .single();

  if (error || !data) {
    // Added by someone else a moment ago: return that supplier
    if (error?.code === "23505") {
      const again = await findSupplierByName(supabase, fields.name);
      if (again) {
        return result({
          ok: true,
          existing: true,
          supplier: again,
          message: "This supplier already exists.",
        });
      }
    }
    return result({
      error: error
        ? friendlyError(error, "The supplier could not be saved.")
        : "The supplier could not be saved.",
    });
  }

  revalidatePath(SUPPLIERS_PATH);
  return result({
    ok: true,
    message: `"${data.name}" has been added.`,
    supplier: { id: data.id, name: data.name, phone: data.phone },
  });
}

export async function searchSuppliers(
  query: unknown
): Promise<SupplierOption[]> {
  const text = cleanSearch(normalize(query)).slice(0, 60);
  if (!text) return [];

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, READ_PERMISSIONS)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, phone")
    .eq("is_active", true)
    .ilike("name", `%${text}%`)
    .order("name")
    .limit(8);

  if (error) {
    console.error("searchSuppliers error:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
  }));
}

export async function updateSupplier(
  _previousState: SupplierFormState,
  formData: FormData
): Promise<SupplierFormState> {
  const fail = (error: string): SupplierFormState => ({ error, success: null });

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, MANAGE_PERMISSIONS)) {
    return fail("You do not have permission to edit suppliers.");
  }

  const supplierId = String(formData.get("supplier_id") ?? "");
  if (!UUID_PATTERN.test(supplierId)) return fail("Invalid supplier ID.");

  const fields: Fields = {
    name: normalize(formData.get("name")),
    phone: normalize(formData.get("phone")),
    address: multiline(formData.get("address")),
    notes: multiline(formData.get("notes")),
  };
  const invalid = validate(fields);
  if (invalid) return fail(invalid);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .update({
      name: fields.name,
      phone: fields.phone || null,
      address: fields.address || null,
      notes: fields.notes || null,
    })
    .eq("id", supplierId)
    .select("id");

  if (error) {
    return fail(friendlyError(error, "The supplier could not be saved."));
  }
  if (!data || data.length === 0) {
    return fail("The supplier could not be saved. Please check your permissions.");
  }

  revalidatePath(SUPPLIERS_PATH);
  return { error: null, success: "Supplier saved." };
}

export async function setSupplierActive(
  _previousState: SupplierFormState,
  formData: FormData
): Promise<SupplierFormState> {
  const fail = (error: string): SupplierFormState => ({ error, success: null });

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, MANAGE_PERMISSIONS)) {
    return fail("You do not have permission to change suppliers.");
  }

  const supplierId = String(formData.get("supplier_id") ?? "");
  if (!UUID_PATTERN.test(supplierId)) return fail("Invalid supplier ID.");
  const active = String(formData.get("active")) === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .update({ is_active: active })
    .eq("id", supplierId)
    .select("id");

  if (error) return fail(friendlyError(error, "The change could not be saved."));
  if (!data || data.length === 0) {
    return fail("The change could not be saved. Please check your permissions.");
  }

  revalidatePath(SUPPLIERS_PATH);
  return { error: null, success: active ? "Activated." : "Deactivated." };
}
