import { formatCloudTrialStartedDetail } from "../billing/CloudTrialStartedNotice";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";

export type CloudSetupPanelProps = {
  readonly aiServerStatusLabel: string;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly cloudStatusLabel: string;
  readonly cloudTrialEndsAt: string | null;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly isSupabaseConfigured: boolean;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly userEmail: string | null;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: (billingInterval?: BillingInterval) => void | Promise<void>;
};

export function CloudSetupPanel({
  aiServerStatusLabel,
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingEntitlementStatus,
  billingPlansDisabled,
  cloudStatusRefreshing,
  cloudStatusLabel,
  cloudTrialEndsAt,
  currentBillingPlan,
  isSupabaseConfigured,
  shouldShowCloudCheckoutPlans,
  userEmail,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: CloudSetupPanelProps) {
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const isCurrentTrial = isCurrentCloudPlan && billingEntitlementStatus === "trialing";
  const maskedUserEmail = maskCloudAccountEmail(userEmail);
  const primaryActionLabel = cloudActionLabel({
    billingCheckoutLoadingInterval,
    cloudStatusRefreshing,
    isCurrentCloudPlan,
    isSupabaseConfigured,
  });
  const primaryActionDisabled = billingPlansDisabled || cloudStatusRefreshing || billingCheckoutLoadingInterval !== null;
  const handlePrimaryAction = isCurrentCloudPlan ? onRefreshCloudStatus : () => onStartCloudSetup();

  return (
    <div className="ai-setup-detail ai-setup-detail--cloud" role="group" aria-label="Drifty Cloud settings">
      <div className="ai-setup-detail__summary">
        <span className="ai-setup-detail__status">{[aiServerStatusLabel, cloudStatusLabel].filter(Boolean).join(" · ")}</span>
        {maskedUserEmail ? <span>{maskedUserEmail}</span> : null}
        {billingEntitlementError ? <span className="ai-setup-detail__message">{billingEntitlementError}</span> : null}
      </div>
      <div className="ai-setup-cloud-route" aria-label="Drifty Cloud checkout route">
        <div className="ai-setup-cloud-route__copy">
          <strong>{isCurrentTrial ? "1-week free trial is active" : isCurrentCloudPlan ? "Cloud AI is active" : "Continue with Drifty Cloud"}</strong>
          <p>{isCurrentTrial ? formatCloudTrialStartedDetail(cloudTrialEndsAt) : isCurrentCloudPlan ? "Refresh the account entitlement if the status looks stale." : "Drifty will open the Polar checkout after account sign-in is confirmed."}</p>
        </div>
        <button type="button" className="settings-btn settings-btn--primary" onClick={() => void handlePrimaryAction()} disabled={primaryActionDisabled}>
          {primaryActionLabel}
        </button>
      </div>
    </div>
  );
}

function cloudActionLabel({
  billingCheckoutLoadingInterval,
  cloudStatusRefreshing,
  isCurrentCloudPlan,
  isSupabaseConfigured,
}: {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly cloudStatusRefreshing: boolean;
  readonly isCurrentCloudPlan: boolean;
  readonly isSupabaseConfigured: boolean;
}): string {
  if (billingCheckoutLoadingInterval !== null) return "Opening checkout...";
  if (cloudStatusRefreshing) return "Checking...";
  if (!isSupabaseConfigured || !isCurrentCloudPlan) return "Set up Drifty Cloud";
  return "Refresh Drifty Cloud";
}

function maskCloudAccountEmail(email: string | null): string | null {
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return null;

  const [localPart, domain, ...extraParts] = trimmedEmail.split("@");
  if (!localPart || !domain || extraParts.length > 0) return trimmedEmail;
  return `${localPart.slice(0, Math.min(2, localPart.length))}***@${domain}`;
}
