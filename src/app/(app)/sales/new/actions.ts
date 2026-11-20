"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { PERMISSION_TRADE_IN, TradeInInputError, parseTradeIn } from "@/lib/trade-in";
import { PhoneOptionError, ptaValue, resolvePhoneOption } from "@/lib/phone-options";
import { ptaLabel } from "@/lib/pta";

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
  // "PTA Approved", "Non-PTA", "JV" or null
  pta: string | null;
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

// Exactly what the create_quick_sale database function returns.
// purchase_no and supplier_balance exist only when something was sourced.
export type SaleResult = {
  sale_id: string;
  invoice_no: number;
  total: number;
  paid: number;
  balance: number;
  purchase_no?: number | null;
  supplier_balance?: number | null;
  // Set when the customer traded in an old phone
  trade_in?: number | null;
  trade_in_id?: string | null;
  trade_in_no?: number | null;
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
  pta_status: string | null;
};

type ProductRow = { id: string; name: string; sale_price: number | string | null };
type ProductStockRow = { product_id: string; qty: number | string | null };
type CustomerRow = { id: string; name: string; phone: string | null; is_active: boolean };

const PHONE_UNIT_COLUMNS =
  "id, imei, brand_name, model_name, storage_gb, ram_gb, color_name, condition, sale_price, pta_status";

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
    pta: ptaLabel(unit.pta_status),
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
    // Words in any order, partial words allowed: "iph 15 pro 256 blue".
    // The longest word with a letter narrows in the database; then every
    // typed word must appear in "Brand Model 256GB Colour PTA".
    const tokens = query.toLowerCase().split(" ").filter(Boolean);
    const narrow = [...tokens].filter((t) => /[a-z]/.test(t)).sort((a, b) => b.length - a.length)[0];
    let request = supabase.from("phone_units").select(PHONE_UNIT_COLUMNS).eq("status", "in_stock");
    if (narrow) {
      request = request.or(
        `brand_name.ilike.%${narrow}%,model_name.ilike.%${narrow}%,color_name.ilike.%${narrow}%`
      );
    }
    const { data, error } = await request.order("model_name").limit(300);
    if (error) throw new Error(error.message);
    units = ((data ?? []) as PhoneUnitRow[])
      .filter((u) => {
        const storage = u.storage_gb ?? 0;
        const label = [
          u.brand_name,
          u.model_name,
          storage ? `${storage}gb` : "",
          storage ? storageLabel(storage).replace(/\s+/g, "").toLowerCase() : "",
          u.ram_gb ? `${u.ram_gb}gb` : "",
          u.color_name,
          ptaLabel(u.pta_status),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
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

const CONDITIONS = new Set(["new", "used", "open_box", "refurbished"]);
const IMEI_PATTERN = /^\d{15}$/;

// Whole cents from a validated amount (at most 2 decimals), for exact sums
function cents(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

function uuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new InputError(message);
  return value;
}

function paymentMethod(value: unknown, message: string): "cash" | "bank" {
  if (value === "cash" || value === "bank") return value;
  throw new InputError(message);
}

// Validates the sale part. Returns the payload for create_sale plus the
// totals needed for the checks below.
// tradeInCredit: value of a trade-in, which pays part of the invoice
function buildSale(input: unknown, tradeInCredit = 0) {
  if (!isRecord(input)) throw new InputError("The sale is not valid.");
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new InputError("Add at least one item.");
  }
  if (input.items.length > 200) throw new InputError("A sale can have at most 200 lines.");

  const seenPhones = new Set<string>();
  const seenImeis = new Set<string>();
  let lineTotal = BigInt(0);
  let sourcedCost = BigInt(0);
  let sourcedCount = 0;

  const items = input.items.map((raw, index) => {
    if (!isRecord(raw)) throw new InputError(`Line ${index + 1} is not valid.`);
    const line = `Line ${index + 1}`;
    const common = {
      unit_price: amount(raw.unit_price, `${line}: unit price`),
      discount: amount(raw.discount ?? 0, `${line}: discount`),
      warranty_days: wholeNumber(raw.warranty_days ?? 0, `${line}: warranty days`, 0, 3650),
    };
    const sourced = raw.sourced === true;

    let quantity = 1;
    let item: Row;

    if (raw.item_type === "phone" && sourced) {
      // A phone that is not in stock yet: bought from the supplier in the same save
      const imei = raw.imei;
      if (typeof imei !== "string" || !IMEI_PATTERN.test(imei)) {
        throw new InputError(`${line}: the IMEI must be exactly 15 digits.`);
      }
      if (seenImeis.has(imei)) throw new InputError(`${line}: IMEI ${imei} is entered twice.`);
      seenImeis.add(imei);
      const condition = typeof raw.condition === "string" ? raw.condition : "new";
      if (!CONDITIONS.has(condition)) throw new InputError(`${line}: condition is not valid.`);
      item = {
        item_type: "phone",
        sourced: true,
        // Storage/RAM and colour are turned into catalog ids before saving
        spec: {
          model_id: uuid(raw.model_id, `${line}: choose a model.`),
          storage_gb: raw.storage_gb,
          ram_gb: raw.ram_gb ?? null,
          color_name: raw.color_name ?? null,
        },
        condition,
        pta_status: ptaValue(raw.pta_status, line),
        imei,
        unit_cost: amount(raw.unit_cost, `${line}: purchase price`),
        ...common,
      };
    } else if (raw.item_type === "phone") {
      const id = uuid(raw.phone_unit_id, `${line}: the phone is not valid.`);
      if (seenPhones.has(id)) throw new InputError(`${line}: this phone is already on the invoice.`);
      seenPhones.add(id);
      item = { item_type: "phone", phone_unit_id: id, ...common };
    } else if (raw.item_type === "unstocked") {
      // Not in stock: bought from another shop on the spot. No stock, purchase
      // or supplier; only the name, the cost and an optional IMEI or serial.
      quantity = wholeNumber(raw.quantity, `${line}: quantity`, 1, 10000);
      const description = optionalText(raw.description, 200, `${line}: item name`);
      if (!description) throw new InputError(`${line}: enter the item name.`);
      const pta = ptaValue(raw.pta_status, line);
      item = {
        item_type: "unstocked",
        description,
        imei: optionalText(raw.imei, 40, `${line}: IMEI or serial number`),
        quantity,
        unit_cost: amount(raw.unit_cost, `${line}: cost price`),
        pta_status: pta,
        ...common,
      };
    } else if (raw.item_type === "accessory") {
      quantity = wholeNumber(raw.quantity, `${line}: quantity`, 1, 100000);
      item = {
        item_type: "accessory",
        product_id: uuid(raw.product_id, `${line}: the product is not valid.`),
        quantity,
        ...common,
      };
      if (sourced) {
        item.sourced = true;
        item.unit_cost = amount(raw.unit_cost, `${line}: purchase price`);
      }
    } else {
      throw new InputError(`${line}: unknown item type.`);
    }

    const gross = cents(common.unit_price) * BigInt(quantity);
    const discount = cents(common.discount);
    if (discount > gross) {
      throw new InputError(`${line}: the discount cannot be more than the line amount.`);
    }
    lineTotal += gross - discount;
    if (sourced) {
      sourcedCount += 1;
      sourcedCost += cents(item.unit_cost as number) * BigInt(quantity);
    }
    return item;
  });

  const discount = amount(input.discount ?? 0, "Invoice discount");
  const paid = amount(input.paid_amount ?? 0, "Paid now");
  const total = lineTotal - cents(discount);
  if (total < BigInt(0)) throw new InputError("The invoice discount cannot be more than the subtotal.");
  if (cents(paid) > total) throw new InputError("Paid now cannot be more than the grand total.");
  const covered = cents(paid) + cents(tradeInCredit);

  const sale: Row = {
    discount,
    paid_amount: paid,
    payment_method: paymentMethod(input.payment_method, "Choose Cash or Bank as the payment method."),
    notes: optionalText(input.notes, 1000, "Notes"),
    items,
  };

  // The customer's name and phone are always sent too, so the sale keeps a
  // snapshot of them even when an existing customer was chosen.
  const name = optionalText(input.customer_name, 120, "Customer name");
  const phone = optionalText(input.customer_phone, 40, "Customer phone");
  if (input.customer_id !== undefined && input.customer_id !== null) {
    sale.customer_id = uuid(input.customer_id, "The customer is not valid.");
  }
  if (name) sale.customer_name = name;
  if (phone) sale.customer_phone = phone;

  // Never save unpaid money against a walk-in customer
  if (covered < total && !sale.customer_id && !(name && phone)) {
    throw new InputError(
      "Customer name and phone are required when part of the amount remains unpaid."
    );
  }

  return { sale, sourcedCount, sourcedCost, total };
}

export async function createQuickSale(input: unknown): Promise<CreateSaleResult> {
  try {
    const permissions = await getMyPermissions();
    if (!permissions.includes("sales.create")) {
      return { ok: false, error: "You do not have permission to create sales.", result: null };
    }
    if (!isRecord(input)) throw new InputError("The sale is not valid.");

    // Trade-in: the customer's old phone pays part of the invoice
    let tradeIn: Row | null = null;
    if (input.trade_in !== undefined && input.trade_in !== null) {
      if (!permissions.includes(PERMISSION_TRADE_IN)) {
        throw new InputError("You do not have permission to take a trade-in.");
      }
      tradeIn = parseTradeIn(input.trade_in);
      // The seller is the buyer: a walk-in sale gets the seller's name and phone
      if (isRecord(input.sale) && !input.sale.customer_id && !input.sale.customer_phone) {
        input.sale = {
          ...input.sale,
          customer_name: tradeIn.seller_name,
          customer_phone: tradeIn.seller_phone,
        };
      }
    }

    const { sale, sourcedCount, sourcedCost, total } = buildSale(input.sale, tradeIn ? (tradeIn.price as number) : 0);
    const payload: Row = { sale };
    if (tradeIn) {
      if (cents(sale.paid_amount as number) + cents(tradeIn.price as number) > total) {
        throw new InputError("The trade-in value plus Paid now cannot be more than the grand total.");
      }
      payload.trade_in = tradeIn;
    }

    if (sourcedCount > 0) {
      if (!permissions.includes("purchases.manage")) {
        throw new InputError("You do not have permission to buy items from a supplier.");
      }
      payload.supplier_id = uuid(
        input.supplier_id,
        "Choose a supplier for the items that are not in stock."
      );
      const supplierPaid = amount(input.supplier_paid_amount ?? 0, "Paid to supplier now");
      if (cents(supplierPaid) > sourcedCost) {
        throw new InputError("Paid to supplier cannot be more than the cost of the sourced items.");
      }
      payload.supplier_paid_amount = supplierPaid;
      if (supplierPaid > 0) {
        payload.supplier_payment_method = paymentMethod(
          input.supplier_payment_method,
          "Choose Cash or Bank for the supplier payment."
        );
      }
    }

    const supabase = await createClient();
    // Phones from a supplier and trade-ins: storage/RAM option and colour are
    // found in the catalog, or created when missing
    for (const [index, item] of (sale.items as Row[]).entries()) {
      if (item.spec) {
        const option = await resolvePhoneOption(supabase, item.spec, `Line ${index + 1}`);
        delete item.spec;
        item.model_id = option.model_id;
        item.variant_id = option.variant_id;
        item.color_id = option.color_id;
      }
    }
    if (tradeIn) {
      const option = await resolvePhoneOption(supabase, tradeIn, "Trade-in");
      tradeIn.variant_id = option.variant_id;
      tradeIn.color_id = option.color_id;
    }
    const { data, error } = await supabase.rpc(tradeIn ? "create_trade_in_sale" : "create_quick_sale", {
      p_payload: payload,
    });

    if (error) {
      // The database raises clear English messages; show them as they are
      return { ok: false, error: error.message, result: null };
    }

    revalidatePath("/sales");
    if (sourcedCount > 0) revalidatePath("/purchases");
    if (tradeIn) {
      revalidatePath("/purchases/from-customers");
      revalidatePath("/inventory");
    }
    return { ok: true, error: null, result: data as SaleResult };
  } catch (e) {
    if (e instanceof InputError || e instanceof TradeInInputError || e instanceof PhoneOptionError) {
      return { ok: false, error: e.message, result: null };
    }
    console.error("createQuickSale error:", e);
    return { ok: false, error: "The sale could not be saved. Please try again.", result: null };
  }
}
