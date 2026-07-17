import { useRef } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";

export interface ProjectPassConsentModalProps {
  readonly open: boolean;
  readonly providerLabel: string;
  readonly includesTitles: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const TITLE_ID = "project-pass-consent-title";
const DESCRIPTION_ID = "project-pass-consent-description";

export function ProjectPassConsentModal({
  open,
  providerLabel,
  includesTitles,
  onConfirm,
  onCancel,
}: ProjectPassConsentModalProps): JSX.Element | null {
  useModalDismiss(onCancel, { disabled: !open });

  if (!open) return null;

  return (
    <ProjectPassConsentDialog
      providerLabel={providerLabel}
      includesTitles={includesTitles}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function ProjectPassConsentDialog({
  providerLabel,
  includesTitles,
  onConfirm,
  onCancel,
}: Omit<ProjectPassConsentModalProps, "open">): JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-modal-initial-focus]" });

  return (
    <div className="auth-modal__overlay" onClick={onCancel}>
      <section
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        aria-modal="true"
        className="auth-modal project-pass-consent-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close" onClick={onCancel} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id={TITLE_ID}>Turn on project analysis</h2>
            <p id={DESCRIPTION_ID}>Exactly what leaves your Mac before you turn it on.</p>
          </div>
        </div>

        <ul className="project-pass-consent-modal__points">
          <li>
            A compacted 3-minute activity-window summary — app, site, time, duration, plus your
            project descriptions and work profile — is sent to <strong>{providerLabel}</strong>.
          </li>
          <li>
            It never sends your raw history beyond that summary. Full timeline rows and session history
            stay on your Mac, and your existing AI privacy settings still apply.
          </li>
          {includesTitles ? null : (
            <li>Page and video titles are excluded, because you turned off content context.</li>
          )}
        </ul>

        <div className="modal-foot project-pass-consent-modal__actions">
          <button
            className="modal-btn modal-btn--ghost"
            data-modal-initial-focus
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="modal-btn modal-btn--primary" type="button" onClick={onConfirm}>
            Turn on
          </button>
        </div>
      </section>
    </div>
  );
}
