import { useEffect, useRef, useState } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useLocalization } from "../localization/LocalizationContext";
import type { AccountDeletionResult } from "./accountDeletionService";
import "./AccountDeletionModal.css";

type AccountDeletionModalProps = {
  readonly accountEmail: string | null;
  readonly isAnonymousAccount?: boolean;
  readonly onClose: () => void;
  readonly onDelete: (confirmation: string) => Promise<AccountDeletionResult>;
};

export function AccountDeletionModal({
  accountEmail,
  isAnonymousAccount = false,
  onClose,
  onDelete,
}: AccountDeletionModalProps) {
  const { t } = useLocalization();
  const confirmationTarget = accountEmail?.trim() || "DELETE";
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const matches = confirmation.trim().toLowerCase() === confirmationTarget.toLowerCase();
  useModalDismiss(onClose, { disabled: deleting });
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: deleting });
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-account-deletion-confirmation]" });

  useEffect(() => {
    if (deleting) dialogRef.current?.focus({ preventScroll: true });
  }, [deleting]);

  const handleDelete = async () => {
    if (!matches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await onDelete(confirmation);
      if (result.success) {
        onClose();
        return;
      }
      setError(localizeDeletionFailure(result, isAnonymousAccount, t));
    } catch {
      setError(t("settings.account.deleteError"));
    }
    setDeleting(false);
  };

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        aria-labelledby="account-deletion-modal-title"
        aria-describedby="account-deletion-modal-description account-deletion-modal-impact account-deletion-modal-retention"
        aria-modal="true"
        aria-busy={deleting}
        className="auth-modal modal-shell account-deletion-modal"
        data-modal-variant="compact"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton disabled={deleting} label={t("settings.account.deleteCancel")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="account-deletion-modal-title">{t("settings.account.deleteTitle")}</h2>
            <p id="account-deletion-modal-description">{t("settings.account.deleteDescription")}</p>
          </div>
        </div>

        <div className="account-deletion-modal__impact" id="account-deletion-modal-impact">
          <strong>{t("settings.account.deleteRemovedHeading")}</strong>
          <ul>
            {isAnonymousAccount ? (
              <li>{t("settings.account.deleteAnonymousCloudImpact")}</li>
            ) : (
              <>
                <li>{t("settings.account.deleteCloudImpact")}</li>
                <li>{t("settings.account.deleteTeamsImpact")}</li>
                <li>{t("settings.account.deleteBillingRetention")}</li>
              </>
            )}
          </ul>
        </div>
        <div className="account-deletion-modal__retention" id="account-deletion-modal-retention">
          <strong>{t("settings.account.deleteRetainedHeading")}</strong>
          <p>{t("settings.account.deleteLocalImpact")}</p>
          <p>{t("settings.account.deleteFutureSyncImpact")}</p>
          <p>{t("settings.account.deleteAnalyticsRetention")}</p>
        </div>

        <label className="account-deletion-modal__confirmation">
          <span>{t("settings.account.deleteConfirmation", { target: confirmationTarget })}</span>
          <input
            autoComplete="off"
            data-account-deletion-confirmation
            disabled={deleting}
            spellCheck={false}
            type={accountEmail ? "email" : "text"}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>

        {error ? <p className="auth-modal__error" role="alert">{error}</p> : null}

        <div className="modal-foot">
          <span className="modal-foot__note" id="account-deletion-modal-no-undo">{t("settings.account.deleteNoUndo")}</span>
          <button className="modal-btn modal-btn--ghost" disabled={deleting} type="button" onClick={onClose}>
            {t("settings.account.deleteCancel")}
          </button>
          <button
            className="modal-btn modal-btn--danger"
            disabled={!matches || deleting}
            type="button"
            onClick={() => void handleDelete()}
          >
            {deleting ? t("settings.account.deletingAccount") : t("settings.account.deletePermanently")}
          </button>
        </div>
      </section>
    </div>
  );
}

function localizeDeletionFailure(
  result: Exclude<AccountDeletionResult, { success: true }>,
  isAnonymousAccount: boolean,
  t: ReturnType<typeof useLocalization>["t"],
): string {
  if (result.code === "local_sync_reset_failed") return t("settings.account.deleteErrorLocalSync");
  if (result.code === "local_calendar_disconnect_failed") return t("settings.account.deleteErrorLocalCalendar");
  if (result.code === "shared_team_owner" && result.stage === "billing_stopped") {
    return t("settings.account.deleteErrorSharedTeamAfterBilling");
  }
  if (result.code === "shared_team_owner") return t("settings.account.deleteErrorSharedTeam");
  if (isAnonymousAccount && result.code === "account_state_unknown" && result.stage === "billing_stopped") {
    return t("settings.account.deleteErrorGuestAccountUnknownAfterBilling");
  }
  if (isAnonymousAccount && result.stage === "billing_stopped") {
    return t("settings.account.deleteErrorGuestBillingCleared");
  }
  if (result.code === "account_state_unknown" && result.stage === "billing_stopped") {
    return t("settings.account.deleteErrorAccountUnknownAfterBilling");
  }
  if (result.stage === "billing_stopped") return t("settings.account.deleteErrorBillingStopped");
  if (result.stage === "unknown") return t("settings.account.deleteErrorUnknown");
  return t("settings.account.deleteErrorNotStarted");
}
