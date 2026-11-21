// PTA status of a phone (Pakistan Telecommunication Authority registration).
// Shown only for PKR shops until the region setting arrives.

export type PtaStatus = "approved" | "non_pta" | "jv";

export const PTA_OPTIONS: { value: PtaStatus; label: string }[] = [
  { value: "approved", label: "PTA Approved" },
  { value: "non_pta", label: "Non-PTA" },
  { value: "jv", label: "JV" },
];

export function isPtaStatus(value: unknown): value is PtaStatus {
  return value === "approved" || value === "non_pta" || value === "jv";
}

export function ptaLabel(value: string | null | undefined): string | null {
  return PTA_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

// PTA applies to businesses in Pakistan (region setting)
export function showsPta(region: string | null | undefined): boolean {
  return region !== "AE";
}
