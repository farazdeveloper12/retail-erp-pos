import { formatMoney } from "@/lib/money";

// Shows an amount owed: a coral pill when above zero, plain text otherwise.
export default function BalancePill({
  value,
  currency,
}: {
  value: bigint | null;
  currency: string;
}) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  if (value > BigInt(0)) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-peach px-2.5 py-1 text-xs font-semibold text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" />
        {formatMoney(value, currency)}
      </span>
    );
  }
  return <span className="whitespace-nowrap text-ink-muted">{formatMoney(value, currency)}</span>;
}
