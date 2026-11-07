// Simple original device drawings used as tiles in the catalog.
// "phone" draws a handset, "smartwatch" draws a watch.
export default function DeviceIllustration({
  kind,
  className = "h-20 w-20",
}: {
  kind: string;
  className?: string;
}) {
  if (kind === "smartwatch") {
    return (
      <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
        <rect x="31" y="6" width="18" height="16" rx="4" className="fill-ink-muted/40" />
        <rect x="31" y="58" width="18" height="16" rx="4" className="fill-ink-muted/40" />
        <rect x="22" y="18" width="36" height="44" rx="12" className="fill-surface stroke-ink" strokeWidth="2.5" />
        <rect x="27" y="23" width="26" height="34" rx="8" className="fill-accent-soft" />
        <path d="M40 32v8l5 3" className="fill-none stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="58" y="34" width="4" height="10" rx="2" className="fill-ink" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
      <rect x="22" y="6" width="36" height="68" rx="9" className="fill-surface stroke-ink" strokeWidth="2.5" />
      <rect x="27" y="14" width="26" height="48" rx="4" className="fill-accent-soft" />
      <rect x="34" y="9" width="12" height="2.5" rx="1.25" className="fill-ink" />
      <circle cx="40" cy="68" r="2.5" className="fill-ink-muted" />
      <path d="M31 50l7-8 5 5 6-9" className="fill-none stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
