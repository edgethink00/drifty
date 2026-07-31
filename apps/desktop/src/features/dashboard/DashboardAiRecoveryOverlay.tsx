import type { BillingInterval } from "../billing/billingService";
import { IndividualPlanCards } from "../billing/IndividualPlanCards";
import {
  isCloudBillingVariant,
  type DashboardAiUnavailableState,
  type DashboardAiUnavailableVariant,
} from "./dashboardAiUnavailableState";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";

type DashboardAiRecoveryOverlayProps = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly retrying: boolean;
  readonly state: DashboardAiUnavailableState;
  readonly onClose: () => void;
  readonly onOpenAiSetup: () => void;
  readonly onRetryAi: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
};

export function DashboardAiRecoveryOverlay({
  billingCheckoutLoadingInterval,
  retrying,
  state,
  onClose,
  onOpenAiSetup,
  onRetryAi,
  onSelectBillingPlan,
}: DashboardAiRecoveryOverlayProps) {
  useModalDismiss(onClose, { disabled: retrying });
  return (
    <div className={`dashboard-ai-recovery dashboard-ai-recovery--${state.variant}`}>
      <section className="dashboard-ai-recovery__panel" role="dialog" aria-label="Restore AI analysis">
        <ModalCloseButton label="Dismiss AI recovery" onClick={onClose} />
        <div className="dashboard-ai-recovery__copy">
          <span className="label-mono">{isCloudBillingVariant(state.variant) ? "Cloud AI paused" : "AI disconnected"}</span>
          <h2>{state.title}</h2>
          <p>{state.body}</p>
        </div>
        {isCloudBillingVariant(state.variant) ? (
          <div className="dashboard-ai-recovery__plans">
            <IndividualPlanCards
              loadingInterval={billingCheckoutLoadingInterval}
              onSelectFreePlan={onOpenAiSetup}
              onSelectPlan={onSelectBillingPlan}
            />
          </div>
        ) : (
          <div className="dashboard-ai-recovery__actions">
            <button type="button" className="modal-btn modal-btn--primary" onClick={onRetryAi} disabled={retrying}>
              {retrying ? "Retrying AI..." : "Retry AI"}
            </button>
            <button type="button" className="modal-btn modal-btn--secondary" onClick={onOpenAiSetup}>
              Open AI setup
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export function isDashboardAiRecoveryOverlayVariant(variant: DashboardAiUnavailableVariant): boolean {
  return isCloudBillingVariant(variant) || variant === "provider-disconnected";
}
