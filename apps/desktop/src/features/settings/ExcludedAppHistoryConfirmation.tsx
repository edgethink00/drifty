import { useRef } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import type { DescribedActionError } from "../../lib/actionErrors";
import { useLocalization } from "../localization/LocalizationContext";

type ExcludedAppHistoryConfirmationProps = {
  readonly appName: string;
  readonly count: number;
  readonly deleting: boolean;
  readonly error: DescribedActionError | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/**
 * Removing an excluded app's past records is permanent, like every other
 * history deletion in the app, so it asks first instead of running from the
 * row's button. The count and the app name say exactly what goes.
 */
export function ExcludedAppHistoryConfirmation({ appName, count, deleting, error, onCancel, onConfirm }: ExcludedAppHistoryConfirmationProps) {
  const { t } = useLocalization();
  const panelRef = useRef<HTMLElement>(null);
  useModalDismiss(onCancel, { disabled: deleting });
  const overlayDismiss = useOverlayDismiss(onCancel, { disabled: deleting });
  useAnchoredDialog(panelRef);

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={panelRef}
        className="auth-modal modal-shell excluded-app-history-modal"
        data-modal-variant="compact"
        role="dialog"
        aria-modal="true"
        aria-busy={deleting}
        aria-labelledby="excluded-app-history-title"
        aria-describedby="excluded-app-history-detail"
        data-modal-initial-selector="[data-excluded-app-history-cancel]"
      >
        <div className="auth-modal__header">
          <h2 id="excluded-app-history-title">{t("settings.privacy.excludedAppsDeleteConfirm.title", { name: appName, count })}</h2>
          {/* A failure takes the explanation's place in one grid cell, so the
              buttons below stay where they are. */}
          <div className={`excluded-app-history-modal__detail${error ? " has-error" : ""}`}>
            <p id="excluded-app-history-detail">{t("settings.privacy.excludedAppsDeleteConfirm.detail", { name: appName })}</p>
            {error ? (
              <p className="excluded-app-history-modal__error" role="alert" title={error.detail ?? undefined}>
                {error.message}
                {error.detail ? <span className="sr-only"> {error.detail}</span> : null}
              </p>
            ) : null}
          </div>
        </div>
        {deleting ? <span className="action-status" role="status">{t("common.deleting")}</span> : null}
        <div className="excluded-app-history-modal__actions">
          <button type="button" className="modal-btn modal-btn--ghost" data-excluded-app-history-cancel disabled={deleting} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} aria-busy={deleting} onClick={onConfirm}>
            <ActionLabel busy={deleting} busyLabel={t("common.deleting")}>{t("settings.privacy.excludedAppsDeleteConfirm.confirm")}</ActionLabel>
          </button>
        </div>
      </section>
    </div>
  );
}
