import { useId, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { UpgradeDecisionPanel, type UpgradeDecisionContext } from "./UpgradeDecisionPanel";
import { resolvePlanCardState } from "./planCardState";
import { useLocalization } from "../localization/LocalizationContext";
import type { BillingEntitlement, BillingInterval } from "./billingService";

export function UpgradePlanModal({
  billingActionError,
  billingCheckoutLoadingInterval,
  billingEntitlement = null,
  billingPlansDisabled = false,
  localAiConfigured = false,
  onClose,
  onContinueLocal,
  onSelectBillingPlan,
}: {
  readonly billingActionError: string | null;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  /** The account's live entitlement; a trial must not be described as Free. */
  readonly billingEntitlement?: BillingEntitlement | null;
  readonly billingPlansDisabled?: boolean;
  /** Whether the user already has a working Local AI setup. */
  readonly localAiConfigured?: boolean;
  readonly onClose: () => void;
  readonly onContinueLocal?: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
}) {
  const { t } = useLocalization();
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [checkoutRequested, setCheckoutRequested] = useState(false);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const checkoutOpening = billingCheckoutLoadingInterval !== null;
  const planState = resolvePlanCardState(billingEntitlement);
  const decisionContext: UpgradeDecisionContext = planState === "pro_trial"
    ? "trial-active"
    : planState === "trial_expired"
      ? "trial-ended"
      : localAiConfigured
        ? "upgrade-local"
        : "upgrade";
  const titleKey = decisionContext === "trial-active"
    ? "billing.upgradeModal.activeTitle"
    : decisionContext === "trial-ended"
      ? "billing.upgradeModal.endedTitle"
      : "billing.upgradeModal.title";
  const descriptionKey = decisionContext === "trial-active"
    ? "billing.upgradeModal.activeDescription"
    : decisionContext === "trial-ended"
      ? "billing.upgradeModal.endedDescription"
      : decisionContext === "upgrade-local"
        ? "billing.upgradeModal.localUpgradeDescription"
        : "billing.upgradeModal.upgradeDecisionDescription";
  useModalDismiss(onClose, { disabled: checkoutOpening });
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x" });

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !checkoutOpening) onClose();
  };

  return (
    <div className="dashboard-ai-recovery dashboard-ai-recovery--upgrade" onClick={handleOverlayClick}>
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="dashboard-ai-recovery__panel modal-shell"
        data-modal-variant="workspace"
        data-decision-layout="equal-airy"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton disabled={checkoutOpening} label={t("billing.upgradeModal.dismiss")} onClick={onClose} />
        <div className="dashboard-ai-recovery__copy">
          <h2 id={titleId}>{t(titleKey)}</h2>
          <p id={descriptionId}>{t(descriptionKey)}</p>
        </div>
        <div
          aria-busy={checkoutOpening}
          aria-live="polite"
          className="dashboard-ai-recovery__plans"
        >
          <UpgradeDecisionPanel
            context={decisionContext}
            disabled={billingPlansDisabled}
            loadingInterval={billingCheckoutLoadingInterval}
            onContinueLocal={onContinueLocal}
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
