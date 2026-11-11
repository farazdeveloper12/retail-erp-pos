// Money helpers for DISPLAY only. Amounts are handled as whole cents
// (BigInt) so adding and multiplying never suffers from floating point.
// Saved amounts are always calculated by the database.

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

// Up to 2 decimals, optional thousands separators: "1,250.50"
const MONEY_INPUT = /^\d+(\.\d{1,2})?$/;

export function cleanMoneyInput(value: string): string {
  return value.replace(/,/g, "").trim();
}

export function isValidMoneyInput(value: string): boolean {
  return MONEY_INPUT.test(cleanMoneyInput(value));
}

// Converts an input string, a database number or a numeric string to cents.
export function toCents(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;

  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = value.toFixed(2);
  } else if (typeof value === "string") {
    text = cleanMoneyInput(value);
  } else {
    return null;
  }

  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = BigInt(match[2]) * HUNDRED + BigInt(fraction);
  return match[1] ? -cents : cents;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 123456 cents -> "1,234.56"; whole amounts drop the decimals: "1,234"
export function formatCents(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const whole = groupThousands((abs / HUNDRED).toString());
  const fraction = abs % HUNDRED;
  const text =
    fraction === ZERO ? whole : `${whole}.${fraction.toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

// 123456 cents -> "1234.56" (no separators), for filling an input
export function centsToPlain(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  const whole = (abs / HUNDRED).toString();
  const fraction = abs % HUNDRED;
  const text =
    fraction === ZERO ? whole : `${whole}.${fraction.toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

// Formats any amount with the currency code, or "—" when it is unknown
export function formatMoney(value: unknown, currency?: string): string {
  const cents = toCents(value);
  if (cents === null) return "—";
  return currency ? `${currency} ${formatCents(cents)}` : formatCents(cents);
}
