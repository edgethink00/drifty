type ModalCloseButtonProps = {
  /** Accessible label, e.g. "Close", "Close profile editor". */
  readonly label: string;
  readonly onClick: () => void;
  /** Prevent dismissal while the owning modal is completing an atomic action. */
  readonly disabled?: boolean;
  /** Extra class names appended after the shared `modal-x` chrome class. */
  readonly className?: string;
};

/**
 * The shared circular top-right close button used by every app modal.
 * Styling and placement live in `styles/modal-chrome.css` (`.modal-x`): inside a
 * `.modal-shell` the control is anchored to the header's first line and the
 * content inset rather than to a fixed corner offset, so it lines up with the
 * title beside it and with the fields below it.
 */
export function ModalCloseButton({
  label,
  onClick,
  disabled = false,
  className,
}: ModalCloseButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `modal-x ${className}` : "modal-x"}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        /* Drawn at 13px. Stroke 2 in a 24 viewBox scaled that far down landed
         * under a full device pixel of ink beside a 600-weight title, so the
         * mark read as unfinished rather than restrained. 2.3 restores the
         * weight balance without making the control loud. */
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
