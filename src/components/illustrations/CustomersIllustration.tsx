// Two simple people on a lavender circle.
export default function CustomersIllustration({
  className = "h-24 w-24",
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="fill-lavender" />

      {/* Person in the back */}
      <circle cx="76" cy="46" r="11" className="fill-purple" />
      <path d="M58 86a18 18 0 0 1 36 0Z" className="fill-purple" opacity="0.55" />

      {/* Person in the front */}
      <circle cx="52" cy="52" r="13" className="fill-surface stroke-ink" strokeWidth="2.5" />
      <path
        d="M30 94a22 22 0 0 1 44 0Z"
        className="fill-surface stroke-ink"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      <circle cx="92" cy="28" r="4" className="fill-amber" />
      <circle cx="24" cy="40" r="3" className="fill-accent" />
    </svg>
  );
}
