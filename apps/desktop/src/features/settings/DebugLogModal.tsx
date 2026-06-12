import type { MouseEvent } from "react";

type DebugLogModalProps = {
  readonly text: string;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
};

export function DebugLogModal({ text, onClose, onCopy, onDownload }: DebugLogModalProps) {
  return (
    <div className="auth-modal__overlay debug-log-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal debug-log-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Debug log"
        onClick={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
      >
        <button type="button" className="debug-log-modal__close" aria-label="Close debug log" onClick={onClose}>
          X
        </button>
        <pre className="debug-log-modal__text" aria-label="Debug log JSON">{text}</pre>
        <div className="debug-log-modal__actions">
          <button type="button" className="settings-btn debug-log-modal__action" onClick={onCopy}>Copy</button>
          <button type="button" className="settings-btn settings-btn--primary debug-log-modal__action" onClick={onDownload}>Download</button>
        </div>
      </section>
    </div>
  );
}
