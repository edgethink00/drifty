import type { BillingInterval } from "../billing/billingService";
import { IndividualPlanCards } from "../billing/IndividualPlanCards";
import {
  type DashboardAiUnavailableState,
} from "./dashboardAiUnavailableState";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";

type DashboardAiRecoveryOverlayProps = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly state: DashboardAiUnavailableState;
  readonly onClose: () => void;
  readonly onOpenAiSetup: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
};

export function DashboardAiRecoveryOverlay({
  billingCheckoutLoadingInterval,
  state,
  onClose,
  onOpenAiSetup,
  onSelectBillingPlan,
}: DashboardAiRecoveryOverlayProps) {
  useModalDismiss(onClose);
  return (
    <div className={`dashboard-ai-recovery dashboard-ai-recovery--${state.variant}`}>
      <section className="dashboard-ai-recovery__panel" role="dialog" aria-label="Restore AI analysis">
        <ModalCloseButton label="Dismiss AI recovery" onClick={onClose} />
        <div className="dashboard-ai-recovery__copy">
          <span className="label-mono">Cloud AI paused</span>
          <h2>{state.title}</h2>
          <p>{state.body}</p>
        </div>
        <div className="dashboard-ai-recovery__plans">
          <IndividualPlanCards
            loadingInterval={billingCheckoutLoadingInterval}
            onSelectFreePlan={onOpenAiSetup}
            onSelectPlan={onSelectBillingPlan}
          />
        </div>
      </section>
    </div>
  );
}
