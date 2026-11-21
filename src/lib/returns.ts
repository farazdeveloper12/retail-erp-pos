// Shared helpers for sales returns, purchase returns and warranty claims.

function docNo(prefix: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value).trim();
  return /^\d+$/.test(text) ? `${prefix}-${text.padStart(6, "0")}` : text;
}

export const formatSalesReturnNo = (value: unknown) => docNo("SR", value);
export const formatPurchaseReturnNo = (value: unknown) => docNo("PR", value);
export const formatClaimNo = (value: unknown) => docNo("WC", value);
export const formatPurchaseNo = (value: unknown) => docNo("PUR", value);

// ---------- Warranty claims ----------

export type ClaimStatus = "received" | "sent_out" | "repaired" | "replaced" | "rejected" | "returned";

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  received: "Received",
  sent_out: "Sent for repair",
  repaired: "Repaired",
  replaced: "Replaced",
  rejected: "Rejected",
  returned: "Returned to customer",
};

export const CLAIM_STATUSES = Object.keys(CLAIM_STATUS_LABELS) as ClaimStatus[];

export function claimStatusLabel(status: string) {
  return CLAIM_STATUS_LABELS[status as ClaimStatus] ?? status;
}

// Same rules as the database function update_warranty_claim
export const CLAIM_NEXT: Record<ClaimStatus, ClaimStatus[]> = {
  received: ["sent_out", "repaired", "replaced", "rejected"],
  sent_out: ["repaired", "replaced", "rejected"],
  repaired: ["returned"],
  replaced: ["returned"],
  rejected: ["returned"],
  returned: [],
};

export function claimTone(status: string): "purple" | "teal" | "amber" | "mint" | "coral" | "neutral" {
  if (status === "received") return "amber";
  if (status === "sent_out") return "purple";
  if (status === "repaired" || status === "replaced") return "teal";
  if (status === "rejected") return "coral";
  if (status === "returned") return "mint";
  return "neutral";
}

// ---------- Warranty status of a sold item ----------

export type WarrantyStatus = "active" | "expired" | "none";

export function warrantyStatusLabel(status: string, daysLeft: number) {
  if (status === "active") return daysLeft === 0 ? "Active · last day" : `Active · ${daysLeft} days left`;
  if (status === "expired") return "Expired";
  return "No warranty";
}

// Today's date in Pakistan time, as YYYY-MM-DD
export { todayIn } from "@/lib/dashboard";
