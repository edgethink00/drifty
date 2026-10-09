import type { MouseEvent } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";

type DebugLogModalProps = {
  readonly text: string;
  /** Footer note, e.g. "Generated 14:20:06 · v1.8.2". */
  readonly note?: string;
  readonly onClose: () => void;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
};

export function DebugLogModal({ text, note, onClose, onCopy, onDownload }: DebugLogModalProps) {
  useModalDismiss(onClose);
  const overlayDismiss = useOverlayDismiss(onClose);
  return (
    <div className="auth-modal__overlay debug-log-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell debug-log-modal"
        data-modal-variant="workspace"
        role="dialog"
        aria-modal="true"
        aria-label="Debug log"
        onClick={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close debug log" onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2>Debug log</h2>
          </div>
        </div>
        <pre className="debug-log-modal__text" aria-label="Debug log JSON">{text}</pre>
        <div className="modal-foot debug-log-modal__actions">
          {note ? <span className="modal-foot__note">{note}</span> : null}
          <button type="button" className="modal-btn modal-btn--secondary debug-log-modal__action" onClick={onCopy}>Copy</button>
          <button type="button" className="modal-btn modal-btn--primary debug-log-modal__action" onClick={onDownload}>Download</button>
        </div>
      </section>
    </div>
  );
}
