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
 * Styling lives in `styles/modal-chrome.css` (`.modal-x`).
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
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
