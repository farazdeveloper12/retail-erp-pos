"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";

type Db = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

// ---------- Types shared with the client ----------

export type PhoneOption = {
  kind: "phone";
  phone_unit_id: string;
  model: string;
  storage: string | null;
  color: string | null;
  condition: string | null;
  imei: string;
  sale_price: number | string | null;
  // Only present for users with inventory.view_cost
  cost?: number | string | null;
};

export type AccessoryOption = {
  kind: "accessory";
  product_id: string;
  name: string;
  in_stock: number;
  sale_price: number | string | null;
  // Only present for users with inventory.view_cost
  cost?: number | string | null;
};

export type SaleItemOption = PhoneOption | AccessoryOption;

export type ItemSearchResult = {
  ok: boolean;
  error: string | null;
  items: SaleItemOption[];
};

export type CustomerOption = {
  id: string;
  name: string;
  phone: string | null;
};

// Exactly what the create_sale database function returns
export type SaleResult = {
  sale_id: string;
  invoice_no: number;
  total: number;
  paid: number;
  balance: number;
};

export type CreateSaleResult = {
  ok: boolean;
  error: string | null;
  result: SaleResult | null;
};

// ---------- Database rows (exact column names) ----------

type PhoneUnitRow = {
  id: string;
  imei: string;
  brand_name: string | null;
  model_name: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  color_name: string | null;
  condition: string | null;
  sale_price: number | string | null;
};

type ProductRow = { id: string; name: string; sale_price: number | string | null };
type ProductStockRow = { product_id: string; qty: number | string | null };
type CustomerRow = { id: string; name: string; phone: string | null; is_active: boolean };

const PHONE_UNIT_COLUMNS =
  "id, imei, brand_name, model_name, storage_gb, ram_gb, color_name, condition, sale_price";

// ---------- Helpers ----------

const CONDITION_LABELS: Record<string, string> = {
  new: "New",
  used: "Used",
  open_box: "Open box",
  refurbished: "Refurbished",
};

const MAX_RESULTS = 8;
const MAX_AMOUNT = 1_000_000_000_000;

// Characters that act as wildcards or separators in filters are removed
function cleanSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[%_*\\,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function storageLabel(gb: number) {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

function priceValue(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

async function canSell(): Promise<{ allowed: boolean; seesCost: boolean }> {
  const permissions = await getMyPermissions();
  return {
    allowed: permissions.includes("sales.create"),
    seesCost: permissions.includes("inventory.view_cost"),
  };
}

// ---------- Item search (phones and accessories) ----------

function toPhoneOption(unit: PhoneUnitRow): PhoneOption {
  const storage =
    unit.storage_gb === null
      ? null
      : unit.ram_gb
        ? `${storageLabel(unit.storage_gb)} / ${unit.ram_gb} GB RAM`
        : storageLabel(unit.storage_gb);
  return {
    kind: "phone",
    phone_unit_id: unit.id,
    model: `${unit.brand_name ?? ""} ${unit.model_name ?? ""}`.trim() || "Phone",
    storage,
    color: unit.color_name,
    condition: unit.condition ? CONDITION_LABELS[unit.condition] ?? unit.condition : null,
    imei: unit.imei,
    sale_price: priceValue(unit.sale_price),
  };
}

async function searchPhones(
  supabase: Db,
  query: string,
  seesCost: boolean
): Promise<PhoneOption[]> {
  const compact = query.replace(/\s+/g, "");
  let units: PhoneUnitRow[];

  if (/^\d{3,15}$/.test(compact)) {
    // Partial IMEI, for example the last 4 to 6 digits
    const { data, error } = await supabase
      .from("phone_units")
      .select(PHONE_UNIT_COLUMNS)
      .eq("status", "in_stock")
      .ilike("imei", `%${compact}%`)
      .limit(MAX_RESULTS);
    if (error) throw new Error(error.message);
    units = (data ?? []) as PhoneUnitRow[];
  } else {
    // Brand and model: the first word narrows in the database,
    // then every typed word must appear in "Brand Model"
    const tokens = query.toLowerCase().split(" ").filter(Boolean);
    const first = tokens[0];
    const { data, error } = await supabase
      .from("phone_units")
      .select(PHONE_UNIT_COLUMNS)
      .eq("status", "in_stock")
      .or(`brand_name.ilike.%${first}%,model_name.ilike.%${first}%`)
      .order("model_name")
      .limit(100);
    if (error) throw new Error(error.message);
    units = ((data ?? []) as PhoneUnitRow[])
      .filter((u) => {
        const label = `${u.brand_name ?? ""} ${u.model_name ?? ""}`.toLowerCase();
        return tokens.every((t) => label.includes(t));
      })
      .slice(0, MAX_RESULTS);
  }

  const options = units.map(toPhoneOption);

  // Cost is read and sent only for users who may see it
  if (seesCost && options.length > 0) {
    const { data: costs } = await supabase
      .from("phone_unit_costs")
      .select("unit_id, landed_cost")
      .in(
        "unit_id",
        options.map((o) => o.phone_unit_id)
      );
    const costById = new Map(
      ((costs ?? []) as { unit_id: string; landed_cost: number | string | null }[]).map((c) => [
        c.unit_id,
        priceValue(c.landed_cost),
      ])
    );
    for (const option of options) option.cost = costById.get(option.phone_unit_id) ?? null;
  }

  return options;
}

async function searchAccessories(
  supabase: Db,
  query: string,
  seesCost: boolean
): Promise<AccessoryOption[]> {
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, sale_price")
    .eq("is_active", true)
    .ilike("name", `%${query}%`)
    .order("name")
    .limit(30);
  if (error) throw new Error(error.message);
  const rows = (products ?? []) as ProductRow[];
  if (rows.length === 0) return [];

  const { data: stock, error: stockError } = await supabase
    .from("product_stock")
    .select("product_id, qty")
    .in(
      "product_id",
      rows.map((p) => p.id)
    )
    .gt("qty", 0);
  if (stockError) throw new Error(stockError.message);

  const qtyById = new Map(
    ((stock ?? []) as ProductStockRow[]).map((s) => [s.product_id, Number(s.qty ?? 0)])
  );

  const options: AccessoryOption[] = [];
  for (const product of rows) {
    const qty = qtyById.get(product.id) ?? 0;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    options.push({
      kind: "accessory",
      product_id: product.id,
      name: product.name,
      in_stock: Math.floor(qty),
      sale_price: priceValue(product.sale_price),
    });
    if (options.length >= MAX_RESULTS) break;
  }

  // Cost is read and sent only for users who may see it
  if (seesCost && options.length > 0) {
    const { data: costs } = await supabase
      .from("product_costs")
      .select("product_id, avg_cost")
      .in(
        "product_id",
        options.map((o) => o.product_id)
      );
    const costById = new Map(
      ((costs ?? []) as { product_id: string; avg_cost: number | string | null }[]).map((c) => [
        c.product_id,
        priceValue(c.avg_cost),
      ])
    );
    for (const option of options) option.cost = costById.get(option.product_id) ?? null;
  }

  return options;
}

export async function searchSaleItems(query: unknown): Promise<ItemSearchResult> {
  const text = cleanSearch(query);
  if (!text) return { ok: true, error: null, items: [] };

  const { allowed, seesCost } = await canSell();
  if (!allowed) {
    return { ok: false, error: "You do not have permission to create sales.", items: [] };
  }

  const supabase = await createClient();
  const [phones, accessories] = await Promise.allSettled([
    searchPhones(supabase, text, seesCost),
    // An IMEI-like search does not need to look at accessories
    /^\d{6,15}$/.test(text.replace(/\s+/g, ""))
      ? Promise.resolve([] as AccessoryOption[])
      : searchAccessories(supabase, text, seesCost),
  ]);

  const items: SaleItemOption[] = [];
  if (phones.status === "fulfilled") items.push(...phones.value);
  else console.error("searchSaleItems phones error:", phones.reason);
  if (accessories.status === "fulfilled") items.push(...accessories.value);
  else console.error("searchSaleItems accessories error:", accessories.reason);

  if (phones.status === "rejected" && accessories.status === "rejected") {
    return { ok: false, error: "Items could not be searched. Please try again.", items: [] };
  }
  return { ok: true, error: null, items: items.slice(0, MAX_RESULTS * 2) };
}

// ---------- Customers ----------

export async function searchCustomers(query: unknown): Promise<CustomerOption[]> {
  const text = cleanSearch(query);
  if (!text) return [];
  const { allowed } = await canSell();
  if (!allowed) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, is_active")
    .eq("is_active", true)
    .or(`name.ilike.%${text}%,phone.ilike.%${text}%`)
    .order("name")
    .limit(MAX_RESULTS);

  if (error) {
    console.error("searchCustomers error:", error.message);
    return [];
  }
  return ((data ?? []) as CustomerRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
  }));
}

// Outstanding balance for a customer, or null when there is no row
export async function getCustomerBalance(
  customerId: unknown
): Promise<number | string | null> {
  if (typeof customerId !== "string" || !UUID_PATTERN.test(customerId)) return null;
  const { allowed } = await canSell();
  if (!allowed) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_balances")
    .select("balance")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return null;
  return priceValue((data as { balance: unknown }).balance);
}

// ---------- Save ----------

class InputError extends Error {}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function amount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
    throw new InputError(`${label} must be zero or more.`);
  }
  // At most 2 decimals
  if (Math.round(value * 100) / 100 !== value) {
    throw new InputError(`${label} can have at most 2 decimal places.`);
  }
  return value;
}

function wholeNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new InputError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new InputError(`${label} is not valid.`);
  const text = value.trim().replace(/[ \t]+/g, " ");
  if (text === "") return null;
  if (text.length > max) throw new InputError(`${label} cannot be longer than ${max} characters.`);
  return text;
}

function buildPayload(input: unknown) {
  if (!isRecord(input)) throw new InputError("The sale is not valid.");
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new InputError("Add at least one item.");
  }
  if (input.items.length > 200) throw new InputError("A sale can have at most 200 lines.");

  const seenPhones = new Set<string>();
  const items = input.items.map((raw, index) => {
    if (!isRecord(raw)) throw new InputError(`Line ${index + 1} is not valid.`);
    const line = `Line ${index + 1}`;
    const common = {
      unit_price: amount(raw.unit_price, `${line}: unit price`),
      discount: amount(raw.discount ?? 0, `${line}: discount`),
      warranty_days: wholeNumber(raw.warranty_days ?? 0, `${line}: warranty days`, 0, 3650),
    };

    if (raw.item_type === "phone") {
      if (typeof raw.phone_unit_id !== "string" || !UUID_PATTERN.test(raw.phone_unit_id)) {
        throw new InputError(`${line}: the phone is not valid.`);
      }
      if (seenPhones.has(raw.phone_unit_id)) {
        throw new InputError(`${line}: this phone is already on the invoice.`);
      }
      seenPhones.add(raw.phone_unit_id);
      return { item_type: "phone", phone_unit_id: raw.phone_unit_id, ...common };
    }

    if (raw.item_type === "accessory") {
      if (typeof raw.product_id !== "string" || !UUID_PATTERN.test(raw.product_id)) {
        throw new InputError(`${line}: the product is not valid.`);
      }
      return {
        item_type: "accessory",
        product_id: raw.product_id,
        quantity: wholeNumber(raw.quantity, `${line}: quantity`, 1, 100000),
        ...common,
      };
    }

    throw new InputError(`${line}: unknown item type.`);
  });

  const paymentMethod =
    input.payment_method === "cash" || input.payment_method === "bank"
      ? input.payment_method
      : null;
  if (!paymentMethod) throw new InputError("Choose Cash or Bank as the payment method.");

  const payload: Row = {
    discount: amount(input.discount ?? 0, "Invoice discount"),
    paid_amount: amount(input.paid_amount ?? 0, "Paid now"),
    payment_method: paymentMethod,
    notes: optionalText(input.notes, 1000, "Notes"),
    items,
  };

  if (input.customer_id !== undefined && input.customer_id !== null) {
    if (typeof input.customer_id !== "string" || !UUID_PATTERN.test(input.customer_id)) {
      throw new InputError("The customer is not valid.");
    }
    payload.customer_id = input.customer_id;
  } else {
    const name = optionalText(input.customer_name, 120, "Customer name");
    const phone = optionalText(input.customer_phone, 40, "Customer phone");
    if (name) payload.customer_name = name;
    if (phone) payload.customer_phone = phone;
  }

  return payload;
}

export async function createSale(input: unknown): Promise<CreateSaleResult> {
  try {
    const { allowed } = await canSell();
    if (!allowed) {
      return { ok: false, error: "You do not have permission to create sales.", result: null };
    }

    const payload = buildPayload(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_sale", { p_payload: payload });

    if (error) {
      // The database raises clear English messages; show them as they are
      return { ok: false, error: error.message, result: null };
    }

    revalidatePath("/sales");
    return { ok: true, error: null, result: data as SaleResult };
  } catch (e) {
    if (e instanceof InputError) return { ok: false, error: e.message, result: null };
    console.error("createSale error:", e);
    return { ok: false, error: "The sale could not be saved. Please try again.", result: null };
  }
}
