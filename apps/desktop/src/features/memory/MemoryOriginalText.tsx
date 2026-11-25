import { useRef } from "react";
import { KeyHint } from "../../components/KeyHint";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import type { MemoryOriginal } from "../screen-context/memoryWire";
import type { MemoryCopy } from "./memoryCopy";
import { appName } from "./memoryCopy";

/**
 * An original whose screen image is gone while memory still keeps what it read
 * (text retention can outlast screens). Shows the text, and forgetting it works
 * as in the screen viewer.
 */
export function MemoryOriginalText({ original, copy, time, busy, onForget, onClose }: {
  readonly original: MemoryOriginal;
  readonly copy: MemoryCopy;
  readonly time: (ms: number) => string;
  readonly busy: boolean;
  readonly onForget: () => void;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalDismiss(onClose, { disabled: busy });
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: busy });
  useAnchoredDialog(dialogRef);
  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section ref={dialogRef} className="auth-modal modal-shell memory-original-text" data-modal-variant="standard"
        role="dialog" aria-modal="true" aria-labelledby="memory-original-text-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <ModalCloseButton disabled={busy} label={copy.closeDetail} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="memory-original-text-title">{copy.viewerTitle}</h2>
            <p>{appName(original.app) + " · " + time(original.observedAtMs)}</p>
          </div>
        </div>
        <p className="work-memory-quiet">{copy.originalTextOnly}</p>
        <pre className="memory-original-text__body">{original.text}</pre>
        <div className="modal-foot">
          <button type="button" className="modal-btn modal-btn--ghost" disabled={busy} onClick={onForget}>{copy.forgetOriginal}</button>
          <button type="button" className="modal-btn" disabled={busy} onClick={onClose}>{copy.closeOriginal}<KeyHint shortcut="escape" /></button>
        </div>
      </section>
    </div>
  );
}
