import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";

import { useLocalization } from "../localization/LocalizationContext";
import { ActionLabel } from "../../components/ActionLabel";

type DeleteManagedModelModalProps = {
  readonly modelLabel: string;
  readonly deleting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/**
 * Confirmation dialog for deleting an installed managed local model. Mirrors the
 * app's other settings dialogs (auth-modal shell + a danger confirm button) so the
 * destructive action can't fire from a single dropdown click.
 *
 * The footer uses `.modal-btn`, not `.settings-btn`. This dialog belongs to
 * Settings, but its footer is a modal surface: a Settings control here renders in
 * mono type at a 10rem minimum width, which reads as a settings row that wandered
 * into a compact dialog. The two sibling confirmations owned by Settings, cloud
 * device removal and history deletion, already resolve it the same way.
 */
export function DeleteManagedModelModal({ modelLabel, deleting, onCancel, onConfirm }: DeleteManagedModelModalProps) {
  const { t } = useLocalization();

  useModalDismiss(onCancel, { disabled: deleting });
  const overlayDismiss = useOverlayDismiss(onCancel, { disabled: deleting });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        className="auth-modal modal-shell ai-delete-model-modal"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-delete-model-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="auth-modal__header">
          <h2 id="ai-delete-model-title">{t("settings.ai.deleteModelConfirmTitle")}</h2>
          <p>{t("settings.ai.deleteModelConfirmBody", { model: modelLabel })}</p>
        </div>
        <div className="ai-delete-model-modal__actions">
          <button type="button" className="modal-btn modal-btn--ghost" disabled={deleting} onClick={onCancel}>
            {t("settings.ai.deleteModelConfirmCancel")}
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} aria-busy={deleting} onClick={onConfirm}>
            <ActionLabel busy={deleting} busyLabel={t("settings.ai.deleteModelDeleting")}>{t("settings.ai.deleteModel")}</ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}
