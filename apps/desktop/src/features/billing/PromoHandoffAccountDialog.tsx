import { useRef, useState } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useLocalization } from "../localization/LocalizationContext";

export function PromoHandoffAccountDialog({
  onKeepAccount,
  onSwitchAccount,
}: {
  readonly onKeepAccount: () => void;
  readonly onSwitchAccount: () => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(false);
  useModalDismiss(onKeepAccount, { disabled: switching });
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x" });

  async function handleSwitchAccount() {
    if (switching) return;
    setSwitching(true);
    setSwitchError(false);
    try {
      await onSwitchAccount();
    } catch {
      setSwitchError(true);
      setSwitching(false);
    }
  }

  return (
    <div className="auth-modal__overlay">
      <section
        ref={dialogRef}
        className="auth-modal modal-shell"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-handoff-account-title"
        aria-describedby="promo-handoff-account-description"
        aria-busy={switching}
        tabIndex={-1}
      >
        <ModalCloseButton disabled={switching} label={t("promoHandoff.keepAccount")} onClick={onKeepAccount} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="promo-handoff-account-title">{t("promoHandoff.wrongAccountTitle")}</h2>
            <p id="promo-handoff-account-description">{t("promoHandoff.wrongAccountDescription")}</p>
          </div>
        </div>
        {switchError ? <p className="auth-modal__error" role="alert">{t("promoHandoff.switchAccountError")}</p> : null}
        <div className="auth-modal__form">
          <button
            type="button"
            className="modal-btn modal-btn--primary modal-btn--block"
            disabled={switching}
            onClick={() => void handleSwitchAccount()}
          >
            {t(switching ? "promoHandoff.switchingAccount" : "promoHandoff.switchAccount")}
          </button>
          <button
            type="button"
            className="modal-btn modal-btn--secondary modal-btn--block"
            disabled={switching}
            onClick={onKeepAccount}
          >
            {t("promoHandoff.keepAccount")}
          </button>
        </div>
      </section>
    </div>
  );
}
