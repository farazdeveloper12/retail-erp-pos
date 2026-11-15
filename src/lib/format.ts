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

export type DateFormat = "medium" | "dmy" | "mdy" | "iso";

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "medium", label: "14 Nov 2026" },
  { value: "dmy", label: "14/11/2026" },
  { value: "mdy", label: "11/14/2026" },
  { value: "iso", label: "2026-11-14" },
];

// Date (optionally with time) in Pakistan time, in the format chosen in Settings
export function formatDateWith(value: unknown, format: DateFormat, withTime = false): string {
  if (typeof value !== "string" || value === "") return "—";
  // A plain YYYY-MM-DD value is a calendar day, not a moment in time
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const time = withTime ? `, ${parts.hour}:${parts.minute}` : "";

  if (format === "dmy") return `${parts.day}/${parts.month}/${parts.year}${time}`;
  if (format === "mdy") return `${parts.month}/${parts.day}/${parts.year}${time}`;
  if (format === "iso") return `${parts.year}-${parts.month}-${parts.day}${time}`;
  const medium = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Karachi",
  }).format(date);
  return `${medium}${time}`;
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
