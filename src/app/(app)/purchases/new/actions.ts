"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

// ---------- Types shared with the client ----------

export type CatalogVariant = {
  id: string;
  storage_gb: number;
  ram_gb: number | null;
};
export type CatalogColor = { id: string; name: string };
export type CatalogModel = {
  id: string;
  name: string;
  variants: CatalogVariant[];
  colors: CatalogColor[];
};
export type CatalogBrand = { id: string; name: string; models: CatalogModel[] };

export type CatalogResult = {
  ok: boolean;
  error: string | null;
  brands: CatalogBrand[];
};

export type PurchaseResult = {
  purchase_id: string;
  purchase_no: string | number | null;
  total: number | string | null;
  balance: number | string | null;
};

export type SavePurchaseResult = {
  ok: boolean;
  error: string | null;
  result: PurchaseResult | null;
};

// ---------- Helpers ----------

const CONDITIONS = new Set(["new", "used", "open_box", "refurbished"]);
const PAYMENT_METHODS = new Set(["cash", "bank"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMEI_PATTERN = /^\d{15}$/;
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_IMEIS = 1000;

async function canManagePurchases(): Promise<boolean> {
  const permissions = await getMyPermissions();
  return permissions.includes("purchases.manage");
}

class InputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function amount(value: unknown, label: string, optional = false): number | null {
  if (value === null || value === undefined || value === "") {
    if (optional) return null;
    throw new InputError(`${label} is required.`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InputError(`${label} must be a number.`);
  }
  if (value < 0 || value > MAX_AMOUNT) {
    throw new InputError(`${label} must be zero or more.`);
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new InputError(`${label} is not valid.`);
  }
  return value;
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new InputError(`${label} is not valid.`);
  const text = value.trim();
  if (text === "") return null;
  if (text.length > max) {
    throw new InputError(`${label} cannot be longer than ${max} characters.`);
  }
  return text;
}

// ---------- Catalog for the purchase screen ----------

type ModelRow = {
  id: string;
  name: string;
  brands: { id: string; name: string; is_active: boolean } | null;
  model_variants: (CatalogVariant & { is_active: boolean })[];
  model_colors: (CatalogColor & { is_active: boolean })[];
};

// Active brands -> active models -> active variants and colours
export async function loadPurchaseCatalog(): Promise<CatalogResult> {
  if (!(await canManagePurchases())) {
    return { ok: false, error: "You do not have permission to record purchases.", brands: [] };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_models")
    .select(
      "id, name, brands(id, name, is_active), model_variants(id, storage_gb, ram_gb, is_active), model_colors(id, name, is_active)"
    )
    .eq("is_active", true)
    .order("name")
    .limit(2000);

  if (error) {
    console.error("loadPurchaseCatalog error:", error.message);
    return { ok: false, error: "The catalog could not be loaded.", brands: [] };
  }

  const byBrand = new Map<string, CatalogBrand>();
  for (const row of (data ?? []) as unknown as ModelRow[]) {
    const brand = row.brands;
    if (!brand || !brand.is_active) continue;

    const variants = row.model_variants
      .filter((v) => v.is_active)
      .sort(
        (a, b) => a.storage_gb - b.storage_gb || (a.ram_gb ?? 0) - (b.ram_gb ?? 0)
      )
      .map(({ id, storage_gb, ram_gb }) => ({ id, storage_gb, ram_gb }));
    const colors = row.model_colors
      .filter((c) => c.is_active)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name }) => ({ id, name }));

    if (!byBrand.has(brand.id)) {
      byBrand.set(brand.id, { id: brand.id, name: brand.name, models: [] });
    }
    byBrand.get(brand.id)!.models.push({ id: row.id, name: row.name, variants, colors });
  }

  const brands = [...byBrand.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, error: null, brands };
}

// ---------- IMEI stock check ----------

// Returns the IMEIs from the list that are already in stock
export async function checkImeisInStock(imeis: unknown): Promise<string[]> {
  if (!Array.isArray(imeis)) return [];
  const list = [
    ...new Set(
      imeis.filter((i): i is string => typeof i === "string" && IMEI_PATTERN.test(i))
    ),
  ].slice(0, MAX_IMEIS);
  if (list.length === 0) return [];
  if (!(await canManagePurchases())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phone_units")
    .select("imei")
    .eq("status", "in_stock")
    .in("imei", list);

  if (error) {
    console.error("checkImeisInStock error:", error.message);
    return [];
  }
  return (data ?? []).map((row) => String(row.imei));
}

// ---------- Accessory sale price ----------

// Returns the product's saved sale price, if the product has one
export async function getProductSalePrice(
  productId: unknown
): Promise<number | string | null> {
  if (typeof productId !== "string" || !UUID_PATTERN.test(productId)) return null;
  if (!(await canManagePurchases())) return null;

  const supabase = await createClient();
  // "*" so this keeps working even if the column is named differently later
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  const price = (data as Record<string, unknown> | null)?.sale_price;
  return typeof price === "number" || typeof price === "string" ? price : null;
}

// ---------- Save ----------

function buildPayload(input: unknown) {
  if (!isRecord(input)) throw new InputError("The purchase is not valid.");

  const supplierId = uuid(input.supplier_id, "Supplier");
  if (typeof input.purchase_date !== "string" || !DATE_PATTERN.test(input.purchase_date)) {
    throw new InputError("Purchase date is not valid.");
  }

  const extraCost = amount(input.extra_cost ?? 0, "Extra cost") ?? 0;
  const paidAmount = amount(input.paid_amount ?? 0, "Paid now") ?? 0;
  let paymentMethod: string | null = null;
  if (paidAmount > 0) {
    if (typeof input.payment_method !== "string" || !PAYMENT_METHODS.has(input.payment_method)) {
      throw new InputError("Choose Cash or Bank as the payment method.");
    }
    paymentMethod = input.payment_method;
  }

  if (!Array.isArray(input.items)) throw new InputError("The purchase has no items.");

  const items: Record<string, unknown>[] = [];
  const seenImeis = new Set<string>();

  input.items.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const line = `Item ${index + 1}`;

    if (raw.item_type === "phone") {
      const imeis = Array.isArray(raw.imeis) ? raw.imeis : [];
      // Empty row: nothing chosen and no IMEIs
      if (!raw.model_id && imeis.length === 0) return;

      const cleanImeis: string[] = [];
      for (const imei of imeis) {
        if (typeof imei !== "string" || !IMEI_PATTERN.test(imei)) {
          throw new InputError(`${line}: every IMEI must be exactly 15 digits.`);
        }
        if (seenImeis.has(imei)) {
          throw new InputError(`${line}: IMEI ${imei} is entered more than once.`);
        }
        seenImeis.add(imei);
        cleanImeis.push(imei);
      }
      if (cleanImeis.length === 0) {
        throw new InputError(`${line}: add at least one IMEI.`);
      }
      const condition = typeof raw.condition === "string" ? raw.condition : "new";
      if (!CONDITIONS.has(condition)) {
        throw new InputError(`${line}: condition is not valid.`);
      }

      items.push({
        item_type: "phone",
        model_id: uuid(raw.model_id, `${line}: model`),
        variant_id: uuid(raw.variant_id, `${line}: storage`),
        color_id: raw.color_id ? uuid(raw.color_id, `${line}: colour`) : null,
        condition,
        unit_cost: amount(raw.unit_cost, `${line}: purchase price`),
        sale_price: amount(raw.sale_price, `${line}: sale price`, true),
        imeis: cleanImeis,
      });
      return;
    }

    if (raw.item_type === "accessory") {
      // Empty row: no product chosen
      if (!raw.product_id) return;
      const quantity = raw.quantity;
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 1_000_000
      ) {
        throw new InputError(`${line}: quantity must be a whole number of 1 or more.`);
      }
      items.push({
        item_type: "accessory",
        product_id: uuid(raw.product_id, `${line}: product`),
        quantity,
        unit_cost: amount(raw.unit_cost, `${line}: purchase price`),
        sale_price: amount(raw.sale_price, `${line}: sale price`, true),
      });
      return;
    }
  });

  if (items.length === 0) throw new InputError("Add at least one phone or accessory.");

  return {
    supplier_id: supplierId,
    purchase_date: input.purchase_date,
    supplier_invoice_no: optionalText(input.supplier_invoice_no, 60, "Supplier invoice no"),
    extra_cost: extraCost,
    paid_amount: paidAmount,
    payment_method: paymentMethod,
    notes: optionalText(input.notes, 1000, "Notes"),
    items,
  };
}

export async function savePurchase(input: unknown): Promise<SavePurchaseResult> {
  try {
    if (!(await canManagePurchases())) {
      return { ok: false, error: "You do not have permission to record purchases.", result: null };
    }

    const payload = buildPayload(input);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_purchase", {
      p_payload: payload,
    });

    if (error) {
      // The database raises readable English messages; show them as they are
      return { ok: false, error: error.message, result: null };
    }

    revalidatePath("/purchases");
    return { ok: true, error: null, result: (data ?? null) as PurchaseResult | null };
  } catch (e) {
    if (e instanceof InputError) {
      return { ok: false, error: e.message, result: null };
    }
    console.error("savePurchase error:", e);
    return {
      ok: false,
      error: "The purchase could not be saved. Please try again.",
      result: null,
    };
  }
}
