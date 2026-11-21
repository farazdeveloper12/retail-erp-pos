"use client";

import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { secondaryButtonClass } from "@/components/ui";
import { PAGE_WIDTH_PT, jpegToPdf } from "@/lib/pdf";

type Paper = "a4" | "thermal";

// Width the document is drawn at for the PDF (A4 or 80 mm at 96 dpi)
const RENDER_WIDTH: Record<Paper, number> = { a4: 794, thermal: 302 };

async function documentPdf(node: HTMLElement, paper: Paper): Promise<Blob> {
  const { toCanvas } = await import("html-to-image");
  // Draw the document at paper width, not at the width of this screen
  const previous = { width: node.style.width, maxWidth: node.style.maxWidth };
  node.style.width = `${RENDER_WIDTH[paper]}px`;
  node.style.maxWidth = "none";
  try {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/jpeg", 0.92)
    );
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    return jpegToPdf(bytes, canvas.width, canvas.height, PAGE_WIDTH_PT[paper]);
  } finally {
    node.style.width = previous.width;
    node.style.maxWidth = previous.maxWidth;
  }
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function isPhone() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// "Share on WhatsApp": makes a PDF of the document. On a phone it opens the
// share sheet (choose WhatsApp there). On a computer the PDF is downloaded
// and WhatsApp opens with the customer's number and a short message, so the
// PDF can be attached.
export default function ShareOnWhatsApp({
  targetId,
  fileName,
  paper,
  phone,
  message,
}: {
  // id of the element to turn into a PDF
  targetId: string;
  fileName: string;
  paper: Paper;
  // International number without "+", for example 923001234567; null = none
  phone: string | null;
  message: string;
}) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<{ file: File; paper: Paper } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const openWhatsApp = () => {
    window.open(`https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  async function share() {
    setNote(null);
    let file = ready && ready.paper === paper ? ready.file : null;
    if (!file) {
      const node = document.getElementById(targetId);
      if (!node) return;
      setBusy(true);
      try {
        const pdf = await documentPdf(node, paper);
        file = new File([pdf], `${fileName}.pdf`, { type: "application/pdf" });
        setReady({ file, paper });
      } catch {
        setBusy(false);
        setNote("The PDF could not be made. Use Print and choose \"Save as PDF\" instead.");
        return;
      }
      setBusy(false);
    }

    if (isPhone() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: message });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // The browser needs a fresh tap after the PDF was made
        setNote("The PDF is ready. Tap Share on WhatsApp again to send it.");
      }
      return;
    }

    download(file);
    openWhatsApp();
    setNote("The PDF was downloaded. Attach it in the WhatsApp chat that opened.");
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => void share()} disabled={busy} className={secondaryButtonClass}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
        {busy ? "Making PDF..." : "Share on WhatsApp"}
      </button>
      {note && (
        <span className="max-w-xs text-xs text-ink-muted" aria-live="polite">
          {note}
        </span>
      )}
    </span>
  );
}
