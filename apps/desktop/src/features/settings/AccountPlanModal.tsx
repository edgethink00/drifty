import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useLocalization } from "../localization/LocalizationContext";

/** Account keeps its status visible; plan comparison is a deliberate action. */
export function AccountPlanModal({ children, busy, onClose }: {
  readonly children: ReactNode;
  readonly busy: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useLocalization();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useModalDismiss(onClose);
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x", explicitTabNavigation: true });
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="account-plan-overlay" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="account-plan-modal modal-shell" data-modal-variant="workspace"
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        ref={dialogRef} tabIndex={-1}>
        <ModalCloseButton label={t("billing.upgradeModal.dismiss")} onClick={onClose} />
        <header className="account-plan-modal__heading">
          <h2 id={titleId}>{t("settings.account.changePlan")}</h2>
        </header>
        <div aria-busy={busy}>{children}</div>
      </section>
    </div>, document.body,
  );
}
