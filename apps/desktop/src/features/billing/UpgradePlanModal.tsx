import { useId, useRef, useState } from "react";

import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { IndividualPlanCards } from "./IndividualPlanCards";
import { useLocalization } from "../localization/LocalizationContext";
import type { BillingInterval } from "./billingService";

export function UpgradePlanModal({
  billingActionError,
  billingCheckoutLoadingInterval,
  billingPlansDisabled = false,
  onClose,
  onSelectBillingPlan,
}: {
  readonly billingActionError: string | null;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingPlansDisabled?: boolean;
  readonly onClose: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
}) {
  const { t } = useLocalization();
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [checkoutRequested, setCheckoutRequested] = useState(false);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const checkoutOpening = billingCheckoutLoadingInterval !== null;
  useModalDismiss(onClose, { disabled: checkoutOpening });
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x" });

  return (
    <div className="dashboard-ai-recovery dashboard-ai-recovery--upgrade">
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dashboard-ai-recovery__panel modal-shell"
        data-modal-variant="workspace"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <ModalCloseButton disabled={checkoutOpening} label={t("billing.upgradeModal.dismiss")} onClick={onClose} />
        <div className="dashboard-ai-recovery__copy">
          <h2 id={titleId}>{t("billing.upgradeModal.title")}</h2>
          <p id={descriptionId}>{t("billing.upgradeModal.description")}</p>
        </div>
        <div
          aria-busy={checkoutOpening}
          aria-live="polite"
          className="dashboard-ai-recovery__plans"
        >
          <IndividualPlanCards
            currentPlan="free"
            disabled={billingPlansDisabled}
            loadingInterval={billingCheckoutLoadingInterval}
            mode="checkout"
            onSelectPlan={(interval) => {
              setCheckoutRequested(true);
              onSelectBillingPlan(interval);
            }}
          />
          {checkoutRequested && billingActionError ? (
            <p className="dashboard-ai-recovery__error" role="alert">
              {billingActionError}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
