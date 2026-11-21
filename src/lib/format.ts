// Small display helpers shared by the sales screens.

// 42 -> "INV-000042". A value that already looks like an invoice number is kept.
export function formatInvoiceNo(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return `INV-${text.padStart(6, "0")}`;
  return text;
}

// Default time zone when a business has none (Pakistan)
export const DEFAULT_TIME_ZONE = "Asia/Karachi";

// Date and time in the business time zone, for example "11 Nov 2026, 14:05"
export function formatDateTime(value: unknown, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (typeof value !== "string" || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export type DateFormat = "medium" | "dmy" | "mdy" | "iso";

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "medium", label: "14 Nov 2026" },
  { value: "dmy", label: "14/11/2026" },
  { value: "mdy", label: "11/14/2026" },
  { value: "iso", label: "2026-11-14" },
];

// Date (optionally with time) in the business time zone, in the format chosen in Settings
export function formatDateWith(
  value: unknown,
  format: DateFormat,
  withTime = false,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  if (typeof value !== "string" || value === "") return "—";
  // A plain YYYY-MM-DD value is a calendar day, not a moment in time: show it as is
  const calendarDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = calendarDay ? new Date(`${value}T00:00:00Z`) : new Date(value);
  const zone = calendarDay ? "UTC" : timeZone;
  if (Number.isNaN(date.getTime())) return "—";

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
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
    timeZone: zone,
  }).format(date);
  return `${medium}${time}`;
}

// Local phone number to the international format WhatsApp expects.
// Pakistan: "0300 1234567" -> "923001234567". UAE: "050 123 4567" -> "971501234567".
// Numbers with "+", "00" or the country code are kept. Returns null when there is no usable number.
export function toWhatsAppNumber(phone: string | null | undefined, region: string = "PK"): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  const code = region === "AE" ? "971" : "92";
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith(code)) return digits;
  if (digits.startsWith("0")) return `${code}${digits.slice(1)}`;
  // Number typed without the leading 0, for example 300 1234567 or 50 123 4567
  if (region === "AE" ? digits.length === 9 && digits.startsWith("5") : digits.length === 10 && digits.startsWith("3")) {
    return `${code}${digits}`;
  }
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
