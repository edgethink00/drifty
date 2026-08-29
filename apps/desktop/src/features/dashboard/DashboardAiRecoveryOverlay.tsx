import { useRef } from "react";
import type { BillingInterval } from "../billing/billingService";
import { IndividualPlanCards } from "../billing/IndividualPlanCards";
import {
  type DashboardAiUnavailableState,
} from "./dashboardAiUnavailableState";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useLocalization } from "../localization/LocalizationContext";

type DashboardAiRecoveryOverlayProps = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingPlansDisabled?: boolean;
  readonly billingPortalLoading?: boolean;
  readonly state: DashboardAiUnavailableState;
  readonly onClose: () => void;
  readonly onManageCloudBilling?: () => void;
  readonly onOpenAiSetup: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
};

export function DashboardAiRecoveryOverlay({
  billingCheckoutLoadingInterval,
  billingPlansDisabled = false,
  billingPortalLoading = false,
  state,
  onClose,
  onManageCloudBilling,
  onOpenAiSetup,
  onSelectBillingPlan,
}: DashboardAiRecoveryOverlayProps) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLElement>(null);
  useModalDismiss(onClose);
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x" });
  const recoversExistingSubscription = state.variant === "cloud-billing";
  return (
    <div className={"dashboard-ai-recovery dashboard-ai-recovery--" + state.variant}>
      <section ref={dialogRef} className="dashboard-ai-recovery__panel modal-shell" data-modal-variant="workspace" role="dialog" aria-modal="true" aria-label={t("dashboard.aiRecovery.panelAria")} tabIndex={-1}>
        <ModalCloseButton label={t("dashboard.aiRecovery.dismiss")} onClick={onClose} />
        <div className="dashboard-ai-recovery__copy">
          <h2>{t(state.titleKey)}</h2>
          <p>{t(state.bodyKey)}</p>
        </div>
        {recoversExistingSubscription ? (
          <div className="dashboard-ai-recovery__actions">
            <button
              type="button"
              className="modal-btn modal-btn--primary"
              disabled={billingPortalLoading || !onManageCloudBilling}
              onClick={onManageCloudBilling}
            >
              {billingPortalLoading ? t("dashboard.aiRecovery.openingBilling") : t("dashboard.aiRecovery.fixBilling")}
            </button>
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onOpenAiSetup}>
              {t("dashboard.aiRecovery.continueLocal")}
            </button>
          </div>
        ) : (
          <div className="dashboard-ai-recovery__plans">
            <IndividualPlanCards
              disabled={billingPlansDisabled}
              loadingInterval={billingCheckoutLoadingInterval}
              mode="checkout"
              onSelectFreePlan={onOpenAiSetup}
              onSelectPlan={onSelectBillingPlan}
            />
          </div>
        )}
      </section>
    </div>
  );
}
