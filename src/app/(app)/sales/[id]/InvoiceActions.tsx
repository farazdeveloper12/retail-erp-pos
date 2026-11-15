"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, FileDown, MessageCircle, Printer } from "lucide-react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";

type Paper = "a4" | "thermal";

const STORAGE_KEY = "invoice-paper";
const CHANGE_EVENT = "invoice-paper-change";

// The last paper choice lives in localStorage; read it safely.
// Returns null when nothing was chosen yet on this device.
function readStoredPaper(): Paper | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "thermal" || value === "a4" ? value : null;
  } catch {
    return null;
  }
}

function writePaper(paper: Paper) {
  try {
    window.localStorage.setItem(STORAGE_KEY, paper);
  } catch {
    // Saving the choice is optional
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

const PAGE_STYLES: Record<Paper, string> = {
  a4: "@media print { @page { size: A4; margin: 12mm; } }",
  thermal: "@media print { @page { size: 80mm auto; margin: 3mm; } }",
};

// Action bar (never printed) and the printable invoice area.
export default function InvoiceActions({
  saleId,
  whatsappUrl,
  autoPrint,
  defaultPaper = "a4",
  extraActions,
  children,
}: {
  saleId: string;
  whatsappUrl: string;
  autoPrint: boolean;
  // Paper size from Settings, used until someone picks a size on this device
  defaultPaper?: Paper;
  // More buttons for the actions bar, for example "Cancel invoice"
  extraActions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const paper = useSyncExternalStore(
    subscribe,
    () => readStoredPaper() ?? defaultPaper,
    () => defaultPaper
  );
  const printed = useRef(false);

  // /sales/[id]?print=1 opens the print dialog once, then cleans the URL
  useEffect(() => {
    if (!autoPrint) return;
    const timer = setTimeout(() => {
      if (printed.current) return;
      printed.current = true;
      window.print();
      router.replace(`/sales/${saleId}`, { scroll: false });
    }, 400);
    return () => clearTimeout(timer);
  }, [autoPrint, router, saleId]);

  const paperButton = (value: Paper, label: string) => (
    <button
      type="button"
      aria-pressed={paper === value}
      onClick={() => writePaper(value)}
      className={
        "min-h-11 rounded-full px-4 text-xs font-semibold transition-colors " +
        (paper === value ? "bg-pill text-pill-ink shadow-soft" : "text-ink-muted hover:text-ink")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <style>{PAGE_STYLES[paper]}</style>

      {/* Actions bar: hidden when printing */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-soft print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Paper size"
            className="inline-flex rounded-full border border-line bg-surface-muted p-1"
          >
            {paperButton("a4", "A4")}
            {paperButton("thermal", "Thermal 80 mm")}
          </div>
          <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button type="button" onClick={() => window.print()} className={secondaryButtonClass}>
            <FileDown className="h-4 w-4" />
            Download PDF
          </button>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButtonClass}
          >
            <MessageCircle className="h-4 w-4" />
            Share on WhatsApp
          </a>
          <Link href="/sales" className={secondaryButtonClass}>
            <ArrowLeft className="h-4 w-4" />
            Back to sales
          </Link>
          {extraActions}
        </div>
        <div className="space-y-0.5 text-xs text-ink-muted">
          <p>Download PDF: choose &quot;Save as PDF&quot; as the destination in the print dialog.</p>
          <p>To send the PDF itself, use Download PDF and attach it in WhatsApp.</p>
        </div>
      </div>

      {/* Printable area; the paper choice switches the layout */}
      <div data-paper={paper} className="group">
        {children}
      </div>
    </div>
  );
}
