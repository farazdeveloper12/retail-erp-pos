// Small display helpers shared by the sales screens.

// 42 -> "INV-000042". A value that already looks like an invoice number is kept.
export function formatInvoiceNo(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return `INV-${text.padStart(6, "0")}`;
  return text;
}

// Date and time in Pakistan time, for example "11 Nov 2026, 14:05"
export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(date);
}

// Pakistani phone number to the international format WhatsApp expects:
// "0300 1234567" -> "923001234567"; "+92 300..." and "92300..." are kept.
// Returns null when there is no usable number.
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

// 7 -> "7 days", 1 -> "1 day", 0 -> "No warranty"
export function formatWarranty(days: number | null | undefined): string {
  if (!days || days <= 0) return "No warranty";
  return days === 1 ? "1 day" : `${days} days`;
}

// "cash" -> "Cash", "bank" -> "Bank"
export function paymentMethodLabel(method: string | null | undefined): string {
  if (method === "cash") return "Cash";
  if (method === "bank") return "Bank";
  return method ? method : "—";
}
