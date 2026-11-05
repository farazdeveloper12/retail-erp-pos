import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Har page ke liye kaun si ijazat chahiye.
// Neeche di hui ijazaton mein se koi ek bhi ho to page khul jata hai.
// Key wahi hai jo navigation.ts mein "slug" hai (Dashboard ke liye khali).
export const pagePermissions: Record<string, string[]> = {
  "": ["dashboard.view"],
  sales: ["sales.create", "sales.view_own", "sales.view_all"],
  purchases: ["purchases.view"],
  inventory: ["inventory.view"],
  catalog: ["catalog.view"],
  customers: ["customers.view"],
  suppliers: ["suppliers.view"],
  expenses: ["expenses.view"],
  finance: ["finance.view"],
  returns: ["returns.manage"],
  reports: ["reports.basic", "reports.financial"],
  "ai-assistant": ["ai.use"],
  users: ["users.manage"],
  settings: ["settings.manage"],
};

// Is user ki saari ijazatein (database se).
// cache() ka matlab: ek hi request mein bar bar database se na poochho.
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

// Kya ye user is page (slug) ko khol sakta hai?
export function canViewPage(permissions: string[], slug: string): boolean {
  const needed = pagePermissions[slug];
  if (!needed) return false; // Jo page list mein nahi, wahan default "mana"
  return hasAny(permissions, needed);
}