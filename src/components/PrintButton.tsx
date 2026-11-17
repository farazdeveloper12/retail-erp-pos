"use client";

import { Printer } from "lucide-react";
import { primaryButtonClass } from "@/components/ui";

export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={primaryButtonClass + " print:hidden"}>
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
