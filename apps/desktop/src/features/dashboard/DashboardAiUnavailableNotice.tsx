import type { BillingEntitlement } from "../billing/billingService";

export type DashboardAiUnavailableVariant = "trial-ended" | "cloud-billing" | "provider-disconnected" | "connect-ai";

export type DashboardAiUnavailableState = {
  readonly variant: DashboardAiUnavailableVariant;
  readonly title: string;
  readonly body: string;
  readonly ctaLabel: string;
};

export type DashboardAiUnavailableInput = {
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly canUseCloudAiClassification: boolean;
  readonly hasRequiredAccountAuth: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly localAiReady: boolean;
  readonly observedAiClassificationFailure: boolean;
};

const TRIAL_ENDED_STATE = {
  variant: "trial-ended",
  title: "Free trial ended",
  body: "Your local timeline, predefined rules, and local rules are still shown. Choose a plan to resume richer Drifty Cloud AI analysis.",
  ctaLabel: "Choose a plan",
} satisfies DashboardAiUnavailableState;

const CLOUD_BILLING_STATE = {
  variant: "cloud-billing",
  title: "Drifty Cloud billing needs attention",
  body: "Your local timeline, predefined rules, and local rules are still shown. Review plans or billing to resume richer Cloud AI analysis.",
  ctaLabel: "Review plans",
} satisfies DashboardAiUnavailableState;

const PROVIDER_DISCONNECTED_STATE = {
  variant: "provider-disconnected",
  title: "AI provider disconnected",
  body: "Your local timeline, predefined rules, and local rules are still shown. Check OpenRouter or your local provider to resume richer AI analysis.",
  ctaLabel: "Open AI setup",
} satisfies DashboardAiUnavailableState;

const CONNECT_AI_STATE = {
  variant: "connect-ai",
  title: "Connect an AI provider",
  body: "Your local timeline, predefined rules, and local rules are still shown. Richer AI analysis is unavailable until Cloud AI or a local provider is connected.",
  ctaLabel: "Connect AI",
} satisfies DashboardAiUnavailableState;

export function resolveDashboardAiUnavailableState(input: DashboardAiUnavailableInput): DashboardAiUnavailableState | null {
  if (input.billingEntitlement?.status === "locked") {
    return input.billingEntitlement.lockedReason === "trial_expired" ? TRIAL_ENDED_STATE : CLOUD_BILLING_STATE;
  }
  if (input.canUseCloudAiClassification) return null;
  if (input.localAiReady && !input.observedAiClassificationFailure) return null;
  if (input.billingEntitlementLoading && input.isSupabaseConfigured && input.hasRequiredAccountAuth) return null;
  if (input.localAiReady && input.observedAiClassificationFailure) return PROVIDER_DISCONNECTED_STATE;
  if (input.billingEntitlementError) return CONNECT_AI_STATE;
  if (!input.isSupabaseConfigured || !input.hasRequiredAccountAuth) return CONNECT_AI_STATE;
  return CONNECT_AI_STATE;
}

export function DashboardAiUnavailableNotice({
  state,
  onAction,
}: {
  readonly state: DashboardAiUnavailableState;
  readonly onAction: (variant: DashboardAiUnavailableVariant) => void;
}) {
  return (
    <section className={`dashboard-ai-notice dashboard-ai-notice--${state.variant}`} aria-label="AI unavailable notice" role="status">
      <div className="dashboard-ai-notice__copy">
        <span className="label-mono">{isCloudBillingVariant(state.variant) ? "Cloud AI paused" : "AI setup needed"}</span>
        <strong>{state.title}</strong>
        <p>{state.body}</p>
      </div>
      <button type="button" className="settings-btn settings-btn--primary" onClick={() => onAction(state.variant)}>
        {state.ctaLabel}
      </button>
    </section>
  );
}

export function isCloudBillingVariant(variant: DashboardAiUnavailableVariant): boolean {
  return variant === "trial-ended" || variant === "cloud-billing";
}
