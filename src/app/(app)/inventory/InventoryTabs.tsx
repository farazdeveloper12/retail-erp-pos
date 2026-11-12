"use client";

import { useRouter } from "next/navigation";
import SegmentedToggle from "@/components/SegmentedToggle";

const TABS = { Phones: "phones", Accessories: "accessories" } as const;

// Phones / Accessories switch that keeps the tab in the URL (?tab=...)
export default function InventoryTabs({ tab }: { tab: "phones" | "accessories" }) {
  const router = useRouter();
  return (
    <SegmentedToggle
      // Remount when the URL changes so the highlighted tab always matches it
      key={tab}
      options={Object.keys(TABS)}
      defaultValue={tab === "accessories" ? "Accessories" : "Phones"}
      ariaLabel="Inventory section"
      onChange={(label) => {
        const value = TABS[label as keyof typeof TABS] ?? "phones";
        router.push(`/inventory?tab=${value}`);
      }}
    />
  );
}
