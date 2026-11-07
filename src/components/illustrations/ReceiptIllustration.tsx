// A blank receipt with a coin on a peach circle.
export default function ReceiptIllustration({
  className = "h-24 w-24",
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="fill-peach" />

      <path
        d="M40 26H80A4 4 0 0 1 84 30V90L78 86L72 90L66 86L60 90L54 86L48 90L42 86L36 90V30A4 4 0 0 1 40 26Z"
        className="fill-surface stroke-ink"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M46 42H74M46 52H68M46 62H72"
        className="fill-none stroke-ink-muted"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      <circle cx="86" cy="80" r="13" className="fill-coral" />
      <path
        d="M86 74v12M80 80h12"
        className="fill-none stroke-surface"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
