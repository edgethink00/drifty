/** Decorative external-destination cue. The surrounding link or button supplies its name. */
export function ExternalLinkIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`external-link-icon ${className}`.trim()}
      data-direction="external"
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 10.4L10.4 3.6M5.2 3.6h5.2v5.2" />
    </svg>
  );
}
