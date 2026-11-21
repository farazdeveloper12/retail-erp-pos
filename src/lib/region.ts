// Region of a business. It decides what the app shows:
// Pakistan: PKR, PTA status, CNIC, 03XX phone numbers, no VAT/TRN/Arabic.
// UAE: AED, VAT and TRN, Arabic invoices, Emirates ID, 05X phone numbers, no PTA.

export type Region = "PK" | "AE";

export const REGION_OPTIONS: { value: Region; label: string; currency: string; timeZone: string }[] = [
  { value: "PK", label: "Pakistan", currency: "PKR", timeZone: "Asia/Karachi" },
  { value: "AE", label: "UAE", currency: "AED", timeZone: "Asia/Dubai" },
];

export function isRegion(value: unknown): value is Region {
  return value === "PK" || value === "AE";
}

export function regionOf(business: { region?: string | null } | null | undefined): Region {
  return business?.region === "AE" ? "AE" : "PK";
}

export function regionInfo(region: Region) {
  return REGION_OPTIONS.find((r) => r.value === region) ?? REGION_OPTIONS[0];
}

export function phonePlaceholder(region: Region): string {
  return region === "AE" ? "05X XXX XXXX" : "03XX XXXXXXX";
}

export function idNumberLabel(region: Region): string {
  return region === "AE" ? "Emirates ID" : "CNIC";
}

export function timeZoneOf(business: { time_zone?: string | null } | null | undefined): string {
  return business?.time_zone === "Asia/Dubai" ? "Asia/Dubai" : "Asia/Karachi";
}
