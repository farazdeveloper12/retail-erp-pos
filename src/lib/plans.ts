import type { BusinessPlan } from "@/lib/business";

// The pages (navigation slugs) included in each plan. "full" has every page.
// Repair pages will be added to "repair_shop" and "full" in a later step.
const MOBILE_SHOP_PAGES = [
  "",
  "sales",
  "purchases",
  "inventory",
  "catalog",
  "customers",
  "suppliers",
  "expenses",
  "finance",
  "returns",
  "reports",
  "ai-assistant",
  "users",
  "settings",
];

// Repair shops also buy and stock spare parts
const REPAIR_SHOP_PAGES = [
  "",
  "sales",
  "purchases",
  "inventory",
  "customers",
  "suppliers",
  "expenses",
  "finance",
  "reports",
  "ai-assistant",
  "users",
  "settings",
];

export const PLAN_OPTIONS: { value: BusinessPlan; label: string; description: string }[] = [
  { value: "full", label: "Full", description: "Every module." },
  {
    value: "mobile_shop",
    label: "Mobile Shop",
    description: "Phones and accessories: sales, stock with IMEI, purchases, returns and warranty.",
  },
  {
    value: "repair_shop",
    label: "Repair Shop",
    description: "Sales, spare parts stock, purchases and suppliers. Repair pages follow later.",
  },
];

export function isBusinessPlan(value: string): value is BusinessPlan {
  return value === "full" || value === "mobile_shop" || value === "repair_shop";
}

// Is this page (navigation slug) part of the plan? Unknown plans fall back to
// "full" so a business is never locked out of its own pages.
export function planIncludesPage(plan: string | null | undefined, slug: string): boolean {
  if (plan === "mobile_shop") return MOBILE_SHOP_PAGES.includes(slug);
  if (plan === "repair_shop") return REPAIR_SHOP_PAGES.includes(slug);
  return true;
}
