import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// The permissions required for each page.
// Having any one of the listed permissions opens the page.
// The key is the same as "slug" in navigation.ts (empty for the dashboard).
export const pagePermissions: Record<string, string[]> = {
  "": ["dashboard.view"],
  sales: ["sales.create", "sales.view_own", "sales.view_all"],
  purchases: ["purchases.view", "purchases.manage"],
  inventory: ["inventory.view"],
  catalog: ["catalog.view", "catalog.create"],
  customers: ["customers.view", "customers.manage", "customers.create", "sales.create"],
  suppliers: [
    "suppliers.view",
    "suppliers.manage",
    "purchases.view",
    "purchases.manage",
  ],
  expenses: ["expenses.view", "expenses.manage"],
  finance: ["finance.view", "finance.manage"],
  // Sales returns and claims need returns.manage, supplier returns need a
  // purchases permission, and sales staff may check warranties
  returns: ["returns.manage", "purchases.manage", "purchases.view", "sales.create"],
  reports: ["reports.basic", "reports.financial", "dashboard.view"],
  "ai-assistant": ["ai.use"],
  users: ["users.manage"],
  settings: ["settings.manage"],
};

// All permissions of the current user (from the database).
// cache() means the database is asked only once per request.
export const getMyPermissions = cache(async (): Promise<string[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_permissions");

  if (error) {
    console.error("my_permissions error:", error.message);
    return [];
  }

  return Array.isArray(data) ? (data as string[]) : [];
});

export function hasAny(permissions: string[], anyOf: string[]): boolean {
  return anyOf.some((p) => permissions.includes(p));
}

// Can this user open this page (slug)?
export function canViewPage(permissions: string[], slug: string): boolean {
  const needed = pagePermissions[slug];
  if (!needed) return false; // Pages not in the list are denied by default
  return hasAny(permissions, needed);
}