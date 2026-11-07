"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

type Db = Awaited<ReturnType<typeof createClient>>;

export type AccessoryOption = {
  id: string;
  name: string;
  category_name: string | null;
};

export type CreateAccessoryResult = {
  ok: boolean;
  error: string | null;
  message: string | null;
  existing: boolean;
  product: AccessoryOption | null;
  // Set when a new category was created, so the form can offer it next time
  createdCategory: string | null;
};

export type AccessoryFormState = {
  error: string | null;
  success: string | null;
};

// Same rules as the database read policy for products
const READ_PERMISSIONS = [
  "catalog.view",
  "inventory.view",
  "sales.create",
  "purchases.manage",
];
const CREATE_PERMISSIONS = ["catalog.create", "catalog.manage"];
const MANAGE_PERMISSIONS = ["catalog.manage"];

const ACCESSORIES_PATH = "/catalog/accessories";

// Trim and collapse repeated spaces: "  USB   cable " -> "USB cable"
function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

// Characters that act as wildcards in ilike filters are removed for searches
function cleanSearch(value: string): string {
  return value.replace(/[%_*\\,()]/g, " ").replace(/\s+/g, " ").trim();
}

function sameName(a: string, b: string) {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

function categoryName(row: { product_categories: unknown }): string | null {
  const category = row.product_categories as { name?: string } | null;
  return category?.name ?? null;
}

type Fields = {
  name: string;
  category: string;
  barcode: string;
  description: string;
};

function validate(fields: Fields): string | null {
  if (fields.name.length < 1) return "Product name is required.";
  if (fields.name.length > 120) {
    return "Product name cannot be longer than 120 characters.";
  }
  if (fields.category.length > 60) {
    return "Category name cannot be longer than 60 characters.";
  }
  if (fields.barcode.length > 64) {
    return "Barcode cannot be longer than 64 characters.";
  }
  if (fields.description.length > 1000) {
    return "Description cannot be longer than 1000 characters.";
  }
  return null;
}

function friendlyError(
  error: { code?: string; message: string; details?: string | null },
  fallback: string
): string {
  if (error.code === "23505") {
    const text = `${error.message} ${error.details ?? ""}`.toLowerCase();
    if (text.includes("barcode")) {
      return "This barcode is already used by another product.";
    }
    return "A product with this name already exists.";
  }
  if (error.code === "42501") return "You do not have permission to do this.";
  return fallback + " " + error.message;
}

// Finds an existing product by name (case insensitive), if the user can read
async function findProductByName(
  supabase: Db,
  name: string
): Promise<AccessoryOption | null> {
  const { data } = await supabase
    .from("products")
    .select("id, name, product_categories(name)")
    .ilike("name", cleanSearch(name))
    .limit(10);
  // ilike may still match more loosely, so compare exactly here
  const match = (data ?? []).find((row) => sameName(row.name, name));
  return match
    ? { id: match.id, name: match.name, category_name: categoryName(match) }
    : null;
}

// Finds a category by name (case insensitive) or creates it.
async function findOrCreateCategory(
  supabase: Db,
  name: string
): Promise<{ id: string; created: boolean } | { error: string }> {
  const find = async () => {
    const { data } = await supabase
      .from("product_categories")
      .select("id, name")
      .ilike("name", cleanSearch(name))
      .limit(10);
    return (data ?? []).find((row) => sameName(row.name, name)) ?? null;
  };

  const existing = await find();
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await supabase
    .from("product_categories")
    .insert({ name })
    .select("id")
    .single();

  if (data) return { id: data.id, created: true };

  // Someone created it at the same moment: read it again
  if (error?.code === "23505") {
    const again = await find();
    if (again) return { id: again.id, created: false };
    return {
      error:
        "This category already exists, but your account cannot view categories.",
    };
  }
  if (error?.code === "42501") {
    return { error: "You do not have permission to create categories." };
  }
  return {
    error: "The category could not be saved." + (error ? " " + error.message : ""),
  };
}

export async function createAccessory(
  input: unknown
): Promise<CreateAccessoryResult> {
  const result = (
    partial: Partial<CreateAccessoryResult>
  ): CreateAccessoryResult => ({
    ok: false,
    error: null,
    message: null,
    existing: false,
    product: null,
    createdCategory: null,
    ...partial,
  });

  const raw = (typeof input === "object" && input !== null ? input : {}) as
    Record<string, unknown>;
  const fields: Fields = {
    name: normalize(raw.name),
    category: normalize(raw.category),
    barcode: normalize(raw.barcode),
    description: typeof raw.description === "string" ? raw.description.trim() : "",
  };

  // 1) Permission check on the server
  const permissions = await getMyPermissions();
  if (!hasAny(permissions, CREATE_PERMISSIONS)) {
    return result({ error: "You do not have permission to add products." });
  }
  const canRead = hasAny(permissions, READ_PERMISSIONS);

  // 2) Validate
  const invalid = validate(fields);
  if (invalid) return result({ error: invalid });

  const supabase = await createClient();

  // 3) Same name already exists? Return it instead of failing.
  if (canRead) {
    const existing = await findProductByName(supabase, fields.name);
    if (existing) {
      return result({
        ok: true,
        existing: true,
        product: existing,
        message: "This product already exists.",
      });
    }
  }

  // 4) Category: find it or create it
  let categoryId: string | null = null;
  let createdCategory: string | null = null;
  if (fields.category) {
    if (!canRead) {
      return result({
        error:
          "Your account cannot view categories, so a category cannot be set. Save without a category or ask the owner for catalog view access.",
      });
    }
    const category = await findOrCreateCategory(supabase, fields.category);
    if ("error" in category) return result({ error: category.error });
    categoryId = category.id;
    if (category.created) createdCategory = fields.category;
  }

  // 5) Create the product. business_id and created_by come from the database.
  const row = {
    name: fields.name,
    category_id: categoryId,
    barcode: fields.barcode || null,
    description: fields.description || null,
  };

  if (!canRead) {
    // Without read access the new row cannot be returned, so insert only.
    const { error } = await supabase.from("products").insert(row);
    if (error) {
      return result({
        error: friendlyError(error, "The product could not be saved."),
      });
    }
    revalidatePath(ACCESSORIES_PATH);
    return result({
      ok: true,
      message: `"${fields.name}" has been added.`,
      createdCategory,
    });
  }

  const { data, error } = await supabase
    .from("products")
    .insert(row)
    .select("id, name, product_categories(name)")
    .single();

  if (error || !data) {
    // Name added by someone else a moment ago: return that product
    if (error?.code === "23505") {
      const existing = await findProductByName(supabase, fields.name);
      if (existing) {
        return result({
          ok: true,
          existing: true,
          product: existing,
          message: "This product already exists.",
        });
      }
    }
    return result({
      error: error
        ? friendlyError(error, "The product could not be saved.")
        : "The product could not be saved.",
    });
  }

  revalidatePath(ACCESSORIES_PATH);
  return result({
    ok: true,
    message: `"${data.name}" has been added.`,
    product: { id: data.id, name: data.name, category_name: categoryName(data) },
    createdCategory,
  });
}

export async function searchAccessories(
  query: unknown
): Promise<AccessoryOption[]> {
  const text = cleanSearch(normalize(query)).slice(0, 60);
  if (!text) return [];

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, READ_PERMISSIONS)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, product_categories(name)")
    .eq("is_active", true)
    .ilike("name", `%${text}%`)
    .order("name")
    .limit(8);

  if (error) {
    console.error("searchAccessories error:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category_name: categoryName(row),
  }));
}

export async function updateAccessory(
  _previousState: AccessoryFormState,
  formData: FormData
): Promise<AccessoryFormState> {
  const fail = (error: string): AccessoryFormState => ({ error, success: null });

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, MANAGE_PERMISSIONS)) {
    return fail("You do not have permission to edit products.");
  }

  const productId = String(formData.get("product_id") ?? "");
  if (!UUID_PATTERN.test(productId)) return fail("Invalid product ID.");

  const fields: Fields = {
    name: normalize(formData.get("name")),
    category: normalize(formData.get("category")),
    barcode: normalize(formData.get("barcode")),
    description: String(formData.get("description") ?? "").trim(),
  };
  const invalid = validate(fields);
  if (invalid) return fail(invalid);

  const supabase = await createClient();

  let categoryId: string | null = null;
  if (fields.category) {
    const category = await findOrCreateCategory(supabase, fields.category);
    if ("error" in category) return fail(category.error);
    categoryId = category.id;
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      name: fields.name,
      category_id: categoryId,
      barcode: fields.barcode || null,
      description: fields.description || null,
    })
    .eq("id", productId)
    .select("id");

  if (error) {
    return fail(friendlyError(error, "The product could not be saved."));
  }
  if (!data || data.length === 0) {
    return fail("The product could not be saved. Please check your permissions.");
  }

  revalidatePath(ACCESSORIES_PATH);
  return { error: null, success: "Product saved." };
}

export async function setAccessoryActive(
  _previousState: AccessoryFormState,
  formData: FormData
): Promise<AccessoryFormState> {
  const fail = (error: string): AccessoryFormState => ({ error, success: null });

  const permissions = await getMyPermissions();
  if (!hasAny(permissions, MANAGE_PERMISSIONS)) {
    return fail("You do not have permission to change products.");
  }

  const productId = String(formData.get("product_id") ?? "");
  if (!UUID_PATTERN.test(productId)) return fail("Invalid product ID.");
  const active = String(formData.get("active")) === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: active })
    .eq("id", productId)
    .select("id");

  if (error) return fail(friendlyError(error, "The change could not be saved."));
  if (!data || data.length === 0) {
    return fail("The change could not be saved. Please check your permissions.");
  }

  revalidatePath(ACCESSORIES_PATH);
  return { error: null, success: active ? "Activated." : "Deactivated." };
}
