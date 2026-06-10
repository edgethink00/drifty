import type { BillingInterval } from "../billing/billingService";
import { IndividualPlanCards } from "../billing/IndividualPlanCards";
import {
  isCloudBillingVariant,
  type DashboardAiUnavailableState,
  type DashboardAiUnavailableVariant,
} from "./DashboardAiUnavailableNotice";

type DashboardAiRecoveryOverlayProps = {
  readonly billingPlansDisabled: boolean;
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
  billingPlansDisabled,
  retrying,
  state,
  onClose,
  onOpenAiSetup,
  onRetryAi,
  onSelectBillingPlan,
}: DashboardAiRecoveryOverlayProps) {
  return (
    <div className={`dashboard-ai-recovery dashboard-ai-recovery--${state.variant}`}>
      <section className="dashboard-ai-recovery__panel" role="dialog" aria-label="Restore AI analysis">
        <button type="button" className="dashboard-ai-recovery__close" aria-label="Dismiss AI recovery" onClick={onClose}>
          x
        </button>
        <div className="dashboard-ai-recovery__copy">
          <span className="label-mono">{isCloudBillingVariant(state.variant) ? "Cloud AI paused" : "AI disconnected"}</span>
          <h2>{state.title}</h2>
          <p>{state.body}</p>
        </div>
        {isCloudBillingVariant(state.variant) ? (
          <div className="dashboard-ai-recovery__plans">
            <IndividualPlanCards
              disabled={billingPlansDisabled}
              loadingInterval={billingCheckoutLoadingInterval}
              onSelectPlan={onSelectBillingPlan}
            />
          </div>
        ) : (
          <div className="dashboard-ai-recovery__actions">
            <button type="button" className="settings-btn settings-btn--primary" onClick={onRetryAi} disabled={retrying}>
              {retrying ? "Retrying AI..." : "Retry AI"}
            </button>
            <button type="button" className="settings-btn" onClick={onOpenAiSetup}>
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
