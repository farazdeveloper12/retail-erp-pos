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
  slug: string; // Part of the URL. Empty for the dashboard.
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  phase: string; // The phase in which this module will be built
};

export const navItems: NavItem[] = [
  {
    slug: "",
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "A complete overview of your business at a glance.",
    phase: "Phase 3",
  },
  {
    slug: "sales",
    href: "/sales",
    label: "Sales / POS",
    icon: ShoppingCart,
    description: "Fast checkout and invoices for phones and accessories.",
    phase: "Phase 8",
  },
  {
    slug: "purchases",
    href: "/purchases",
    label: "Purchases",
    icon: PackagePlus,
    description: "Purchase stock from suppliers and track landed cost.",
    phase: "Phase 7",
  },
  {
    slug: "inventory",
    href: "/inventory",
    label: "Inventory",
    icon: Boxes,
    description: "Stock of phones (with IMEI) and accessories.",
    phase: "Phase 6",
  },
  {
    slug: "catalog",
    href: "/catalog",
    label: "Product Catalog",
    icon: BookOpen,
    description: "A searchable list of phone models.",
    phase: "Phase 6",
  },
  {
    slug: "customers",
    href: "/customers",
    label: "Customers",
    icon: Users,
    description: "Customers, ledgers and outstanding balances.",
    phase: "Phase 10",
  },
  {
    slug: "suppliers",
    href: "/suppliers",
    label: "Suppliers",
    icon: Truck,
    description: "Suppliers, ledgers and amounts payable.",
    phase: "Phase 10",
  },
  {
    slug: "expenses",
    href: "/expenses",
    label: "Expenses",
    icon: Receipt,
    description: "Rent, utilities, salaries and other expenses.",
    phase: "Phase 11",
  },
  {
    slug: "finance",
    href: "/finance",
    label: "Cash & Bank",
    icon: Landmark,
    description: "Cash, bank accounts, wallets and the transaction ledger.",
    phase: "Phase 11",
  },
  {
    slug: "returns",
    href: "/returns",
    label: "Returns & Warranty",
    icon: RotateCcw,
    description: "Returns, exchanges and warranty claims.",
    phase: "Phase 13",
  },
  {
    slug: "reports",
    href: "/reports",
    label: "Reports",
    icon: TrendingUp,
    description: "Profit and loss and other business reports.",
    phase: "Phase 14",
  },
  {
    slug: "ai-assistant",
    href: "/ai-assistant",
    label: "AI Assistant",
    icon: Sparkles,
    description: "Ask questions and get suggestions about your business.",
    phase: "Phase 15",
  },
  {
    slug: "users",
    href: "/users",
    label: "Users & Roles",
    icon: UserCog,
    description: "Employees and their permissions.",
    phase: "Phase 5",
  },
  {
    slug: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "System and business settings.",
    phase: "Phase 21",
  },
];

// Items shown in the bottom navigation bar on phones
export const bottomNavSlugs = ["", "sales", "inventory", "customers"];