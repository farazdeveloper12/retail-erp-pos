// Stacked boxes with a check badge on a mint circle.
export default function StockedUpIllustration({
  className = "h-24 w-24",
}: {
  className?: string;
}) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <circle cx="60" cy="60" r="56" className="fill-mint" />

      <rect x="28" y="64" width="30" height="26" rx="5" className="fill-surface stroke-ink" strokeWidth="2.5" />
      <rect x="62" y="64" width="30" height="26" rx="5" className="fill-surface stroke-ink" strokeWidth="2.5" />
      <rect x="45" y="36" width="30" height="26" rx="5" className="fill-surface stroke-ink" strokeWidth="2.5" />

      <path
        d="M43 64v9M77 64v9M60 36v9"
        className="fill-none stroke-ink"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      <circle cx="90" cy="36" r="12" className="fill-accent" />
      <path
        d="M84.5 36.5l4 4 7-8"
        className="fill-none stroke-accent-ink"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
