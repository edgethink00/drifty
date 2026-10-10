import { useRef } from "react";
import type { Project } from "@drifty/domain";
import { ActionLabel } from "../../components/ActionLabel";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";

/** `true` once the project is gone; a failure carries the tracker's own wording. */
export type ProjectDeleteResult = boolean | { readonly deleted: false; readonly error: string };

type ProjectDeleteConfirmationProps = {
  readonly project: Project;
  /** Time matched to the project in the library's window, formatted; null when none. */
  readonly matchedTime: string | null;
  /** The window that time covers, e.g. "Latest 7 days". */
  readonly matchedWindow: string;
  readonly deleting: boolean;
  /** Set after a failed attempt. The tracker's wording stays on hover; the line reads in the app's language. */
  readonly error: { readonly detail: string } | null;
  readonly onCancel: () => void;
  /** Offered for an active project: the reversible way to take it out of the list. */
  readonly onArchive?: () => void;
  readonly onConfirm: () => void;
};

/**
 * Deleting a project removes what the user wrote (name, description) and sends
 * its matched time back to No project, and it cannot be undone, while the same
 * menu offers Archive as the reversible way to clear the list. So the menu item
 * asks first, names what goes, and offers Archive in the same place.
 */
export function ProjectDeleteConfirmation({
  project,
  matchedTime,
  matchedWindow,
  deleting,
  error,
  onCancel,
  onArchive,
  onConfirm,
}: ProjectDeleteConfirmationProps) {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  useModalDismiss(onCancel, { disabled: deleting });
  const overlayDismiss = useOverlayDismiss(onCancel, { disabled: deleting });
  useAnchoredDialog(panelRef);

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell project-delete-modal"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-busy={deleting}
        aria-labelledby="project-delete-title"
        aria-describedby="project-delete-detail"
        data-modal-initial-selector="[data-project-delete-cancel]"
      >
        <div className="auth-modal__header">
          <h2 id="project-delete-title">{t("projects.deleteConfirm.title", { name: project.name })}</h2>
          {/* A failure takes the explanation's place in one grid cell, so the
              dialog keeps the taller of the two and the buttons stay put. */}
          <div className={`project-delete-modal__detail${error ? " has-error" : ""}`}>
            <p id="project-delete-detail">{t("projects.deleteConfirm.detail")}</p>
            {error ? (
              <p className="project-delete-modal__error" role="alert" title={error.detail || undefined}>
                {t("projects.deleteConfirm.error")}
              </p>
            ) : null}
          </div>
          {matchedTime ? (
            <p className="project-delete-modal__matched">
              {t("projects.deleteConfirm.matched", { window: matchedWindow, duration: matchedTime })}
            </p>
          ) : null}
        </div>
        {deleting ? <span className="action-status" role="status">{t("projects.deleteConfirm.deleting")}</span> : null}
        <div className="project-delete-modal__actions">
          {onArchive ? (
            <button type="button" className="modal-btn modal-btn--ghost project-delete-modal__archive" disabled={deleting} onClick={onArchive}>
              {t("projects.deleteConfirm.archiveInstead")}
            </button>
          ) : null}
          <button type="button" className="modal-btn modal-btn--ghost" data-project-delete-cancel disabled={deleting} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} aria-busy={deleting} onClick={onConfirm}>
            <ActionLabel busy={deleting} busyLabel={t("projects.deleteConfirm.deleting")}>{t("projects.deleteConfirm.delete")}</ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}
