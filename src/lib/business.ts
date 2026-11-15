import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type DateFormatKey = "medium" | "dmy" | "mdy" | "iso";
export type InvoicePaper = "a4" | "thermal";

export type Business = {
  id: string;
  name: string;
  legal_name: string | null;
  business_type: string | null;
  currency_code: string;
  tax_label: string | null;
  tax_rate: number | string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  is_active: boolean;
  warranty_terms: string | null;
  // Settings
  invoice_footer: string | null;
  date_format: DateFormatKey;
  invoice_paper: InvoicePaper;
  invoice_show_logo: boolean;
  invoice_show_customer_phone: boolean;
  invoice_show_warranty: boolean;
  invoice_show_payment_method: boolean;
  low_stock_threshold: number;
};

const BUSINESS_COLUMNS = [
  "id",
  "name",
  "legal_name",
  "business_type",
  "currency_code",
  "tax_label",
  "tax_rate",
  "address",
  "phone",
  "email",
  "logo_url",
  "is_active",
  "warranty_terms",
  "invoice_footer",
  "date_format",
  "invoice_paper",
  "invoice_show_logo",
  "invoice_show_customer_phone",
  "invoice_show_warranty",
  "invoice_show_payment_method",
  "low_stock_threshold",
].join(", ");

// Fallback name used when no business can be read (login page, errors).
export const DEFAULT_WORKSPACE_NAME = "Retail workspace";

// Used when a setting cannot be read
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

// The current user's business. Uses the normal (publishable key) server
// client, so RLS also limits the result to the user's own business.
// cache() means the database is asked only once per request.
export const getMyBusiness = cache(async (): Promise<Business | null> => {
  const supabase = await createClient();

  // Anonymous visitors (for example on /login) have no business.
  // Return early so the RPC, which anon cannot run, is never called.
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return null;
  }

  const { data: businessId, error: idError } =
    await supabase.rpc("my_business_id");
  if (idError) {
    console.error("my_business_id error:", idError.message);
    return null;
  }
  if (typeof businessId !== "string" || businessId === "") {
    return null;
  }

  const { data, error } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    console.error("getMyBusiness error:", error.message);
    return null;
  }

  return (data as unknown as Business | null) ?? null;
});
