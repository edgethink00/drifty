import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { useRef } from "react";
import type { BillingInterval } from "../billing/billingService";
import { IndividualPlanCards } from "../billing/IndividualPlanCards";
import type { IndividualPricingQuote } from "../billing/individualPricing";
import {
  type DashboardAiUnavailableState,
} from "./dashboardAiUnavailableState";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useLocalization } from "../localization/LocalizationContext";
import { ActionLabel } from "../../components/ActionLabel";

type DashboardAiRecoveryOverlayProps = {
  readonly funnelEnabled?: boolean;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingPlansDisabled?: boolean;
  readonly billingPortalLoading?: boolean;
  readonly individualPricingQuote?: IndividualPricingQuote | null;
  readonly state: DashboardAiUnavailableState;
  readonly onClose: () => void;
  readonly onManageCloudBilling?: () => void;
  readonly onOpenAiSetup: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
};

export function DashboardAiRecoveryOverlay({
  funnelEnabled = false,
  billingCheckoutLoadingInterval,
  billingPlansDisabled = false,
  billingPortalLoading = false,
  individualPricingQuote = null,
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
  // A trial that ended never reaches this overlay: the Pro sheet and its daily notice follow it instead.
  const offerRef = useProFunnelExposure<HTMLDivElement>(funnelEnabled, recoversExistingSubscription ? null : {
    step: "pro_offer_viewed", offer_surface: "recovery_overlay", offer_context: "upgrade",
  });

  return (
    <div className={`dashboard-ai-recovery dashboard-ai-recovery--${state.variant}`}>
      <section
        ref={dialogRef}
        className="dashboard-ai-recovery__panel modal-shell" data-modal-variant="workspace"
        role="dialog" aria-modal="true" aria-label={t("dashboard.aiRecovery.panelAria")}
        tabIndex={-1}
      >
        <ModalCloseButton label={t("dashboard.aiRecovery.dismiss")} onClick={onClose} />
        <div className="dashboard-ai-recovery__copy">
          <h2>{t(state.titleKey)}</h2>
          <p>{t(state.bodyKey)}</p>
          {recoversExistingSubscription ? (
            <p className="dashboard-ai-recovery__meta">{t("dashboard.aiRecovery.billingSafeNote")}</p>
          ) : null}
        </div>
        {recoversExistingSubscription ? (
          <div className="dashboard-ai-recovery__actions">
            <button
              type="button"
              className="modal-btn modal-btn--primary"
              disabled={billingPortalLoading || !onManageCloudBilling}
              aria-busy={billingPortalLoading}
              onClick={onManageCloudBilling}
            >
              <ActionLabel busy={billingPortalLoading} busyLabel={t("dashboard.aiRecovery.openingBilling")}>{t("dashboard.aiRecovery.fixBilling")}</ActionLabel>
            </button>
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onOpenAiSetup}>
              {t("dashboard.aiRecovery.continueLocal")}
            </button>
          </div>
        ) : (
          <div className="dashboard-ai-recovery__plans" ref={offerRef}>
            <IndividualPlanCards
              disabled={billingPlansDisabled}
              loadingInterval={billingCheckoutLoadingInterval}
              mode="checkout"
              onSelectFreePlan={onOpenAiSetup}
              onSelectPlan={onSelectBillingPlan}
              pricingQuote={individualPricingQuote}
            />
          </div>
        )}
      </section>
    </div>
  );
}
