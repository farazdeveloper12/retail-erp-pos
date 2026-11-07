import Link from "next/link";
import { Headphones, Smartphone } from "lucide-react";

// Tabs shown at the top of the catalog pages
export default function CatalogTabs({
  active,
}: {
  active: "models" | "accessories";
}) {
  const tabs = [
    { key: "models", href: "/catalog", label: "Phones and watches", icon: Smartphone },
    { key: "accessories", href: "/catalog/accessories", label: "Accessories", icon: Headphones },
  ] as const;

  return (
    <nav
      aria-label="Catalog sections"
      className="inline-flex w-full rounded-full border border-line bg-surface p-1 shadow-soft sm:w-auto"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors sm:flex-none " +
              (isActive
                ? "bg-pill text-pill-ink"
                : "text-ink-muted hover:text-ink")
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
