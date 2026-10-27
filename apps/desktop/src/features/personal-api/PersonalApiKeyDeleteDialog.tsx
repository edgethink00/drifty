import { useRef } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import "./personalApi.css";

export type PersonalApiKeyDeleteDialogProps = {
  readonly name: string;
  readonly deleting: boolean;
  /** Set after a failed attempt; the dialog stays open on it. */
  readonly failed: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/** Deleting a key stops everything that uses it at once, so the row asks first. */
export function PersonalApiKeyDeleteDialog({ name, deleting, failed, onCancel, onConfirm }: PersonalApiKeyDeleteDialogProps): JSX.Element {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  useModalDismiss(onCancel, { disabled: deleting });
  const overlayDismiss = useOverlayDismiss(onCancel, { disabled: deleting });
  useAnchoredDialog(panelRef);

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell personal-api-delete"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-busy={deleting}
        aria-labelledby="personal-api-delete-title"
        aria-describedby="personal-api-delete-detail"
        data-modal-initial-selector="[data-personal-api-delete-cancel]"
      >
        <div className="auth-modal__header">
          <h2 id="personal-api-delete-title">{t("settings.developer.api.deleteDialog.title", { name })}</h2>
          <p id="personal-api-delete-detail" className="personal-api-delete__detail">{t("settings.developer.api.deleteDialog.detail")}</p>
          {failed && !deleting ? <p className="personal-api-delete__error" role="alert">{t("settings.developer.api.deleteDialog.error")}</p> : null}
        </div>
        <div className="personal-api-delete__actions">
          <button type="button" className="modal-btn modal-btn--ghost" data-personal-api-delete-cancel disabled={deleting} onClick={onCancel}>
            {t("common.cancel")}
            <KeyHint shortcut="escape" />
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} aria-busy={deleting} onClick={onConfirm}>
            <ActionLabel busy={deleting} busyLabel={t("settings.developer.api.deleteDialog.deleting")}>{t("settings.developer.api.deleteDialog.delete")}</ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}
