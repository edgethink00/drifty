import { useRef, type ReactNode } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import "./classificationRulesSheet.css";

/** The heading the rules manager is labelled by when it sits in this sheet. */
export const CLASSIFICATION_RULES_SHEET_HEADING_ID = "classification-rules-sheet-title";

/**
 * App and site rules in their own sheet. Unlike the category editor, every
 * change here saves at once (add, toggle, edit, delete), so the sheet has no
 * Save: Done only closes it. It opens from the Classification page header,
 * Settings › General, and settings search.
 */
export function ClassificationRulesSheet({ onClose, children }: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalDismiss(onClose);
  useAnchoredDialog(dialogRef);
  const overlayDismiss = useOverlayDismiss(onClose);

  return (
    <div className="auth-modal__overlay rules-sheet__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell rules-sheet"
        data-modal-variant="workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby={CLASSIFICATION_RULES_SHEET_HEADING_ID}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("categoryEditor.closeRules")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id={CLASSIFICATION_RULES_SHEET_HEADING_ID}>{t("classification.rules.title")}</h2>
          </div>
        </div>
        <div className="rules-sheet__body content--settings">{children}</div>
        <div className="modal-foot rules-sheet__foot">
          <button type="button" className="modal-btn modal-btn--primary" onClick={onClose}>{t("categoryEditor.done")}</button>
        </div>
      </section>
    </div>
  );
}
