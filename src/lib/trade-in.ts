// Phones bought from customers ("Buy from customer" and POS trade-ins).
// Shared by the client forms (draft and checks) and the server actions
// (validation of what the browser sends). The database checks everything
// again; these checks only give clear messages early.

import { cleanMoneyInput, isValidMoneyInput, toCents } from "@/lib/money";

export const PERMISSION_TRADE_IN = "purchases.manage";

export type TradeInGrade = "A" | "B" | "C";

export const GRADE_OPTIONS: { value: TradeInGrade; label: string }[] = [
  { value: "A", label: "A – like new" },
  { value: "B", label: "B – light marks" },
  { value: "C", label: "C – visible wear or faults" },
];

// What the forms keep while the user types (all text, like the inputs)
export type TradeInDraft = {
  customerId: string | null;
  sellerName: string;
  sellerPhone: string;
  sellerIdNumber: string;
  modelId: string;
  variantId: string;
  colorId: string;
  imei: string;
  grade: TradeInGrade | "";
  notes: string;
  price: string;
  salePrice: string;
};

export const EMPTY_TRADE_IN: TradeInDraft = {
  customerId: null,
  sellerName: "",
  sellerPhone: "",
  sellerIdNumber: "",
  modelId: "",
  variantId: "",
  colorId: "",
  imei: "",
  grade: "",
  notes: "",
  price: "",
  salePrice: "",
};

const IMEI_PATTERN = /^\d{15}$/;
const ID_NUMBER_PATTERN = /^[0-9A-Za-z -]{5,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 1_000_000_000_000;

export function cleanImei(value: string): string {
  return value.replace(/\s/g, "");
}

// Problems in a draft, for the form (empty when it can be saved)
export function tradeInProblems(draft: TradeInDraft): string[] {
  const problems: string[] = [];
  if (!draft.sellerName.trim()) problems.push("Enter the seller's name.");
  if (!draft.sellerPhone.trim()) problems.push("Enter the seller's phone number.");
  const id = draft.sellerIdNumber.trim();
  if (id && !ID_NUMBER_PATTERN.test(id)) {
    problems.push("The CNIC / Emirates ID must be 5 to 40 letters, digits, spaces or dashes.");
  }
  if (!draft.modelId) problems.push("Choose the phone model.");
  else if (!draft.variantId) problems.push("Choose the storage.");
  if (!IMEI_PATTERN.test(cleanImei(draft.imei))) problems.push("The IMEI must be exactly 15 digits.");
  if (!draft.grade) problems.push("Choose the condition grade A, B or C.");
  if (draft.notes.length > 500) problems.push("The condition notes can have at most 500 characters.");
  const price = isValidMoneyInput(draft.price) ? toCents(draft.price) : null;
  if (price === null || price <= BigInt(0)) problems.push("Enter the price (above zero).");
  if (draft.salePrice.trim() && !isValidMoneyInput(draft.salePrice)) problems.push("Enter a valid sale price.");
  return problems;
}

// What the forms send to the server
export function tradeInPayload(draft: TradeInDraft): Record<string, unknown> {
  return {
    customer_id: draft.customerId,
    seller_name: draft.sellerName.trim(),
    seller_phone: draft.sellerPhone.trim(),
    seller_id_number: draft.sellerIdNumber.trim() || null,
    model_id: draft.modelId,
    variant_id: draft.variantId,
    color_id: draft.colorId || null,
    imei: cleanImei(draft.imei),
    grade: draft.grade,
    condition_notes: draft.notes.trim() || null,
    price: Number(cleanMoneyInput(draft.price)),
    sale_price: draft.salePrice.trim() ? Number(cleanMoneyInput(draft.salePrice)) : null,
  };
}

export class TradeInInputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, label: string, required: boolean): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new TradeInInputError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new TradeInInputError(`${label} is not valid.`);
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) {
    if (required) throw new TradeInInputError(`${label} is required.`);
    return null;
  }
  if (clean.length > max) throw new TradeInInputError(`${label} cannot be longer than ${max} characters.`);
  return clean;
}

function uuid(value: unknown, label: string, required: boolean): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new TradeInInputError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string" || !UUID.test(value)) throw new TradeInInputError(`${label} is not valid.`);
  return value;
}

function money(value: unknown, label: string, required: boolean, positive: boolean): number | null {
  if (value === null || value === undefined) {
    if (required) throw new TradeInInputError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
    throw new TradeInInputError(`${label} must be a number of zero or more.`);
  }
  if (positive && value <= 0) throw new TradeInInputError(`${label} must be above zero.`);
  if (Math.round(value * 100) / 100 !== value) {
    throw new TradeInInputError(`${label} can have at most 2 decimal places.`);
  }
  return value;
}

// Server side: checks what the browser sent and returns the database payload
export function parseTradeIn(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new TradeInInputError("The phone details are not valid.");
  const imei = typeof input.imei === "string" ? cleanImei(input.imei) : "";
  if (!IMEI_PATTERN.test(imei)) throw new TradeInInputError("The IMEI must be exactly 15 digits.");
  const idNumber = text(input.seller_id_number, 40, "CNIC / Emirates ID", false);
  if (idNumber && !ID_NUMBER_PATTERN.test(idNumber)) {
    throw new TradeInInputError("The CNIC / Emirates ID must be 5 to 40 letters, digits, spaces or dashes.");
  }
  const grade = input.grade;
  if (grade !== "A" && grade !== "B" && grade !== "C") {
    throw new TradeInInputError("Choose the condition grade A, B or C.");
  }
  return {
    customer_id: uuid(input.customer_id, "Customer", false),
    seller_name: text(input.seller_name, 120, "Seller name", true),
    seller_phone: text(input.seller_phone, 40, "Seller phone", true),
    seller_id_number: idNumber,
    model_id: uuid(input.model_id, "Phone model", true),
    variant_id: uuid(input.variant_id, "Storage", true),
    color_id: uuid(input.color_id, "Colour", false),
    imei,
    grade,
    condition_notes: text(input.condition_notes, 500, "Condition notes", false),
    price: money(input.price, "Price", true, true),
    sale_price: money(input.sale_price, "Sale price", false, false),
  };
}

export function formatCustomerPurchaseNo(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return `CP-${String(value).padStart(6, "0")}`;
}

export function gradeLabel(grade: string | null | undefined): string {
  return GRADE_OPTIONS.find((g) => g.value === grade)?.label ?? grade ?? "—";
}
