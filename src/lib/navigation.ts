import {
  BookOpen,
  Boxes,
  Landmark,
  LayoutDashboard,
  PackagePlus,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  slug: string; // URL ka hissa. Dashboard ke liye khali.
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  phase: string; // Ye module kis phase mein banega
};

export const navItems: NavItem[] = [
  {
    slug: "",
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Karobar ka poora khulasa ek nazar mein.",
    phase: "Phase 3",
  },
  {
    slug: "sales",
    href: "/sales",
    label: "Sales / POS",
    icon: ShoppingCart,
    description: "Phones aur accessories ki tez bikri aur bills.",
    phase: "Phase 8",
  },
  {
    slug: "purchases",
    href: "/purchases",
    label: "Purchases",
    icon: PackagePlus,
    description: "Supplier se maal ki kharidari aur landed cost.",
    phase: "Phase 7",
  },
  {
    slug: "inventory",
    href: "/inventory",
    label: "Inventory",
    icon: Boxes,
    description: "Phones (IMEI ke saath) aur accessories ka stock.",
    phase: "Phase 6",
  },
  {
    slug: "catalog",
    href: "/catalog",
    label: "Product Catalog",
    icon: BookOpen,
    description: "Phone models ki searchable list.",
    phase: "Phase 6",
  },
  {
    slug: "customers",
    href: "/customers",
    label: "Customers",
    icon: Users,
    description: "Customers, ledger aur baqaya raqam.",
    phase: "Phase 10",
  },
  {
    slug: "suppliers",
    href: "/suppliers",
    label: "Suppliers",
    icon: Truck,
    description: "Suppliers, ledger aur ada karne wali raqam.",
    phase: "Phase 10",
  },
  {
    slug: "expenses",
    href: "/expenses",
    label: "Expenses",
    icon: Receipt,
    description: "Kiraya, bijli, tankhwah aur dosray akhrajat.",
    phase: "Phase 11",
  },
  {
    slug: "finance",
    href: "/finance",
    label: "Cash & Bank",
    icon: Landmark,
    description: "Cash, bank, wallets aur transaction ledger.",
    phase: "Phase 11",
  },
  {
    slug: "returns",
    href: "/returns",
    label: "Returns & Warranty",
    icon: RotateCcw,
    description: "Wapsi, exchange aur warranty claims.",
    phase: "Phase 13",
  },
  {
    slug: "reports",
    href: "/reports",
    label: "Reports",
    icon: TrendingUp,
    description: "Profit and loss aur dosri reports.",
    phase: "Phase 14",
  },
  {
    slug: "ai-assistant",
    href: "/ai-assistant",
    label: "AI Assistant",
    icon: Sparkles,
    description: "Karobar ke baare mein sawal aur mashwaray.",
    phase: "Phase 15",
  },
  {
    slug: "users",
    href: "/users",
    label: "Users & Roles",
    icon: UserCog,
    description: "Employees aur unki permissions.",
    phase: "Phase 5",
  },
  {
    slug: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "System aur business ki settings.",
    phase: "Phase 21",
  },
];

// Phone ke neeche wale bar mein kaun se items dikhein
export const bottomNavSlugs = ["", "sales", "inventory", "customers"];