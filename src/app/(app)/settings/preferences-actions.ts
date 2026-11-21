"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { isBusinessPlan } from "@/lib/plans";

export type PreferencesState = { error: string | null; success: string | null };

const ok = (success: string): PreferencesState => ({ error: null, success });
const fail = (error: string): PreferencesState => ({ error, success: null });

const DATE_FORMATS = new Set(["medium", "dmy", "mdy", "iso"]);
const LOGO_BUCKET = "business-logos";
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function requireSettingsManager() {
  const permissions = await getMyPermissions();
  if (!permissions.includes("settings.manage")) return null;
  return getMyBusiness();
}

function friendly(error: { code?: string; message: string }, fallback: string) {
  if (error.code === "23505") return "This name already exists.";
  if (error.code === "42501") return "You do not have permission to do this.";
  return `${fallback} ${error.message}`;
}

function refreshEverywhere() {
  // Settings are read by the shell, invoices, inventory and the dashboard
  revalidatePath("/", "layout");
}

// ---------- Invoice and receipt options ----------

export async function updateInvoiceSettings(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change settings.");

  const paper = String(formData.get("invoice_paper") ?? "");
  const dateFormat = String(formData.get("date_format") ?? "");
  const footer = String(formData.get("invoice_footer") ?? "").trim();
  const warrantyTerms = String(formData.get("warranty_terms") ?? "").trim();

  if (paper !== "a4" && paper !== "thermal") return fail("Choose A4 or Thermal 80 mm.");
  if (!DATE_FORMATS.has(dateFormat)) return fail("Choose a date format.");
  if (footer.length > 500) return fail("The invoice footer cannot be longer than 500 characters.");
  if (warrantyTerms.length > 1000) {
    return fail("The warranty terms cannot be longer than 1000 characters.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .update({
      invoice_paper: paper,
      date_format: dateFormat,
      invoice_footer: footer || null,
      warranty_terms: warrantyTerms || null,
      invoice_show_logo: formData.get("invoice_show_logo") === "on",
      invoice_show_customer_phone: formData.get("invoice_show_customer_phone") === "on",
      invoice_show_warranty: formData.get("invoice_show_warranty") === "on",
      invoice_show_payment_method: formData.get("invoice_show_payment_method") === "on",
    })
    .eq("id", business.id)
    .select("id");

  if (error) return fail(friendly(error, "The invoice settings could not be saved."));
  if (!data?.length) return fail("The invoice settings could not be saved. Please check your permissions.");
  refreshEverywhere();
  return ok("Invoice settings saved.");
}

// ---------- Region, VAT and plan ----------

// 0.01 to 100 with up to 2 decimals, for example 5 or 7.5
const VAT_RATE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
// A UAE Tax Registration Number has 15 digits
const TRN_PATTERN = /^\d{15}$/;

export async function updateTaxRegionSettings(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change settings.");

  const plan = String(formData.get("plan") ?? "");
  if (!isBusinessPlan(plan)) return fail("Choose a plan.");
  const supabase = await createClient();

  // Pakistan: no VAT, TRN or Arabic invoices. Only the plan is saved.
  if (business.region !== "AE") {
    const { data, error } = await supabase
      .from("businesses")
      .update({ plan, vat_enabled: false, invoice_language: "en" })
      .eq("id", business.id)
      .select("id");
    if (error) return fail(friendly(error, "The plan could not be saved."));
    if (!data?.length) return fail("The plan could not be saved. Please check your permissions.");
    refreshEverywhere();
    return ok("Plan saved.");
  }

  const vatEnabled = formData.get("vat_enabled") === "on";
  const vatRate = String(formData.get("tax_rate") ?? "").trim();
  const trn = String(formData.get("trn") ?? "").replace(/[\s-]/g, "");
  const nameAr = String(formData.get("name_ar") ?? "").trim();
  const addressAr = String(formData.get("address_ar") ?? "").trim();
  const language = String(formData.get("invoice_language") ?? "");

  const rateValid = VAT_RATE_PATTERN.test(vatRate) && Number(vatRate) > 0 && Number(vatRate) <= 100;
  // The rate is required when VAT is on; a rate typed while VAT is off must be valid too
  if ((vatEnabled || vatRate !== "") && !rateValid) {
    return fail("The VAT rate must be a number above 0 and up to 100, with up to 2 decimals.");
  }
  if (trn !== "" && !TRN_PATTERN.test(trn)) return fail("The TRN must have exactly 15 digits.");
  if (vatEnabled && trn === "") return fail("Enter the TRN: it is printed on every tax invoice.");
  if (nameAr.length > 120) return fail("The Arabic name cannot be longer than 120 characters.");
  if (addressAr.length > 300) return fail("The Arabic address cannot be longer than 300 characters.");
  if (language !== "en" && language !== "en_ar") return fail("Choose an invoice language.");

  const { data, error } = await supabase
    .from("businesses")
    .update({
      vat_enabled: vatEnabled,
      // Sent as text so the numeric column keeps the exact value. An empty
      // rate keeps the saved value; VAT is off in that case anyway.
      ...(vatRate !== "" ? { tax_rate: vatRate } : {}),
      trn: trn || null,
      name_ar: nameAr || null,
      address_ar: addressAr || null,
      invoice_language: language,
      plan,
    })
    .eq("id", business.id)
    .select("id");

  if (error) return fail(friendly(error, "The tax and region settings could not be saved."));
  if (!data?.length) return fail("The tax and region settings could not be saved. Please check your permissions.");
  refreshEverywhere();
  return ok("Tax and region settings saved.");
}

// ---------- Default warranty ----------

// Empty = no default; otherwise 0 to 3650 days
function warrantyDays(value: FormDataEntryValue | null): number | null | "invalid" {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) > 3650) return "invalid";
  return Number(raw);
}

export async function updateWarrantyDefaults(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change settings.");

  const phone = warrantyDays(formData.get("default_warranty_phone_days"));
  const accessory = warrantyDays(formData.get("default_warranty_accessory_days"));
  if (phone === "invalid" || accessory === "invalid") {
    return fail("The warranty must be a whole number of days from 0 to 3650, or empty.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .update({ default_warranty_phone_days: phone, default_warranty_accessory_days: accessory })
    .eq("id", business.id)
    .select("id");

  if (error) return fail(friendly(error, "The warranty defaults could not be saved."));
  if (!data?.length) return fail("The warranty defaults could not be saved. Please check your permissions.");
  refreshEverywhere();
  return ok("Warranty defaults saved.");
}

// ---------- Stock ----------

export async function updateStockSettings(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change settings.");

  const raw = String(formData.get("low_stock_threshold") ?? "").trim();
  if (!/^\d{1,4}$/.test(raw) || Number(raw) > 1000) {
    return fail("The low stock threshold must be a whole number from 0 to 1000.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .update({ low_stock_threshold: Number(raw) })
    .eq("id", business.id)
    .select("id");

  if (error) return fail(friendly(error, "The stock settings could not be saved."));
  if (!data?.length) return fail("The stock settings could not be saved. Please check your permissions.");
  refreshEverywhere();
  return ok("Stock settings saved.");
}

// ---------- Logo ----------

// Checks the first bytes so a renamed file cannot pretend to be an image
function looksLike(type: string, bytes: Uint8Array) {
  if (type === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp") {
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  }
  return false;
}

// Storage path of a logo URL in our bucket, or null for anything else
function logoPath(url: string | null, businessId: string) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const path = decodeURIComponent(url.slice(index + marker.length));
  return path.startsWith(`${businessId}/`) ? path : null;
}

export async function uploadLogo(_prev: PreferencesState, formData: FormData): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change the logo.");

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return fail("Choose an image file.");
  const ext = LOGO_TYPES[file.type];
  if (!ext) return fail("The logo must be a PNG, JPEG or WebP image.");
  if (file.size > LOGO_MAX_BYTES) return fail("The logo must be 512 KB or smaller.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLike(file.type, bytes)) return fail("This file is not a valid image.");

  const supabase = await createClient();
  const path = `${business.id}/logo-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return fail(`The logo could not be uploaded. ${uploadError.message}`);

  const publicUrl = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  const { data, error } = await supabase
    .from("businesses")
    .update({ logo_url: publicUrl })
    .eq("id", business.id)
    .select("id");
  if (error || !data?.length) {
    // Do not leave an unused file behind
    await supabase.storage.from(LOGO_BUCKET).remove([path]);
    return fail(error ? friendly(error, "The logo could not be saved.") : "The logo could not be saved.");
  }

  // Remove the previous logo file of this business, if there was one
  const previous = logoPath(business.logo_url, business.id);
  if (previous && previous !== path) await supabase.storage.from(LOGO_BUCKET).remove([previous]);

  refreshEverywhere();
  return ok("Logo uploaded.");
}

export async function removeLogo(): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change the logo.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("businesses")
    .update({ logo_url: null })
    .eq("id", business.id)
    .select("id");
  if (error || !data?.length) return fail("The logo could not be removed.");

  const previous = logoPath(business.logo_url, business.id);
  if (previous) await supabase.storage.from(LOGO_BUCKET).remove([previous]);

  refreshEverywhere();
  return ok("Logo removed.");
}

// ---------- Expense categories ----------

function categoryName(formData: FormData) {
  return String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
}

export async function addExpenseCategory(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change settings.");
  const name = categoryName(formData);
  if (name.length < 1 || name.length > 60) return fail("The category name must be 1 to 60 characters.");

  const supabase = await createClient();
  // business_id and created_by come from the database defaults
  const { error } = await supabase.from("expense_categories").insert({ name });
  if (error) return fail(friendly(error, "The category could not be added."));
  revalidatePath("/settings");
  revalidatePath("/expenses");
  return ok(`"${name}" added.`);
}

export async function updateExpenseCategory(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const business = await requireSettingsManager();
  if (!business) return fail("You do not have permission to change settings.");
  const id = String(formData.get("id") ?? "");
  if (!UUID_PATTERN.test(id)) return fail("The category is not valid.");

  const patch: Record<string, unknown> = {};
  if (formData.has("name")) {
    const name = categoryName(formData);
    if (name.length < 1 || name.length > 60) return fail("The category name must be 1 to 60 characters.");
    patch.name = name;
  }
  if (formData.has("active")) patch.is_active = formData.get("active") === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error) return fail(friendly(error, "The category could not be saved."));
  if (!data?.length) return fail("The category could not be saved. Please check your permissions.");
  revalidatePath("/settings");
  revalidatePath("/expenses");
  return ok("Category saved.");
}

// ---------- Product categories (catalog.manage) ----------

export async function updateProductCategory(
  _prev: PreferencesState,
  formData: FormData
): Promise<PreferencesState> {
  const permissions = await getMyPermissions();
  if (!permissions.includes("catalog.manage")) {
    return fail("You do not have permission to change product categories.");
  }
  const id = String(formData.get("id") ?? "");
  if (!UUID_PATTERN.test(id)) return fail("The category is not valid.");

  const patch: Record<string, unknown> = {};
  if (formData.has("name")) {
    const name = categoryName(formData);
    if (name.length < 1 || name.length > 60) return fail("The category name must be 1 to 60 characters.");
    patch.name = name;
  }
  if (formData.has("active")) patch.is_active = formData.get("active") === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_categories")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error) return fail(friendly(error, "The category could not be saved."));
  if (!data?.length) return fail("The category could not be saved. Please check your permissions.");
  revalidatePath("/settings");
  revalidatePath("/catalog/accessories");
  return ok("Category saved.");
}
