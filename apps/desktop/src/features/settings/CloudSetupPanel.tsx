import { formatCloudTrialStartedDetail } from "../billing/CloudTrialStartedNotice";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeAiStatusLabel } from "../localization/aiStatusTranslations";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";

export type CloudSetupPanelProps = {
  readonly aiServerStatusLabel: string;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLockedReason: BillingEntitlement["lockedReason"] | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly billingPortalLoading: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly cloudStatusLabel: string;
  readonly cloudTrialEndsAt: string | null;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly isSupabaseConfigured: boolean;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly userEmail: string | null;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: (billingInterval?: BillingInterval) => void | Promise<void>;
};

export function CloudSetupPanel({
  aiServerStatusLabel,
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingEntitlementLockedReason,
  billingEntitlementStatus,
  billingPlansDisabled,
  billingPortalLoading,
  cloudStatusRefreshing,
  cloudStatusLabel,
  cloudTrialEndsAt,
  currentBillingPlan,
  isSupabaseConfigured,
  shouldShowCloudCheckoutPlans,
  userEmail,
  onManageCloudBilling,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: CloudSetupPanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const isDeviceLimitLocked = billingEntitlementStatus === "locked" && billingEntitlementLockedReason === "device_limit_reached";
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const isCurrentPaidPlan = isCurrentCloudPlan && billingEntitlementStatus === "active";
  const isCurrentTrial = isCurrentCloudPlan && billingEntitlementStatus === "trialing";
  const maskedUserEmail = maskCloudAccountEmail(userEmail);
  const localizedAiServerStatusLabel = localizeAiStatusLabel(aiServerStatusLabel, t);
  const localizedCloudStatusLabel = localizeAiStatusLabel(cloudStatusLabel, t);
  const primaryActionLabel = cloudActionLabel({
    billingCheckoutLoadingInterval,
    billingPortalLoading,
    billingEntitlementStatus,
    billingEntitlementLockedReason,
    cloudStatusRefreshing,
    isCurrentCloudPlan,
    isSupabaseConfigured,
    t,
  });
  const primaryActionDisabled = billingPlansDisabled || cloudStatusRefreshing || billingCheckoutLoadingInterval !== null || billingPortalLoading;
  const handlePrimaryAction = isDeviceLimitLocked || isCurrentPaidPlan
    ? onManageCloudBilling
    : isCurrentTrial || !isCurrentCloudPlan
      ? () => onStartCloudSetup()
      : onRefreshCloudStatus;
  const statusHeadline = isCurrentTrial
    ? t("settings.ai.cloudTrialActive")
    : isDeviceLimitLocked
      ? t("settings.ai.deviceLimitReached")
    : isCurrentCloudPlan
      ? t("settings.ai.cloudActive")
      : [localizedAiServerStatusLabel, localizedCloudStatusLabel].filter(Boolean).join(" · ");
  const statusDetail = isCurrentTrial
    ? localizedCloudTrialDetail(cloudTrialEndsAt, effectiveLanguage, t)
    : isDeviceLimitLocked
      ? t("settings.ai.cloudDeviceLimitDetail")
    : isCurrentCloudPlan
      ? t("settings.ai.cloudManageDetail")
      : null;
  const statusSummary = statusDetail ? `${statusHeadline} · ${statusDetail}` : statusHeadline;

  return (
    <div className="ai-setup-detail ai-setup-detail--cloud" role="group" aria-label={t("settings.ai.driftyCloudSettingsAria")}>
      <article className="ai-setup-cloud-route" aria-label={t("settings.ai.driftyCloudCheckoutAria")}>
        <div className="ai-setup-cloud-route__copy">
          <strong>Drifty Cloud</strong>
          <p>{statusSummary}</p>
          {maskedUserEmail ? <p className="ai-setup-cloud-route__account">{maskedUserEmail}</p> : null}
          {billingEntitlementError ? <p className="ai-setup-detail__message">{localizeSettingsError(billingEntitlementError, effectiveLanguage, t)}</p> : null}
        </div>
        <button type="button" className="settings-btn settings-btn--primary ai-setup-cloud-route__action" onClick={() => void handlePrimaryAction()} disabled={primaryActionDisabled}>
          {primaryActionLabel}
        </button>
      </article>
    </div>
  );
}

function cloudActionLabel({
  billingCheckoutLoadingInterval,
  billingEntitlementLockedReason,
  billingEntitlementStatus,
  billingPortalLoading,
  cloudStatusRefreshing,
  isCurrentCloudPlan,
  isSupabaseConfigured,
  t,
}: {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementLockedReason: BillingEntitlement["lockedReason"] | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPortalLoading: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly isCurrentCloudPlan: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly t: LocalizationController["t"];
}): string {
  if (billingCheckoutLoadingInterval !== null) return t("settings.account.openingCheckout");
  if (billingPortalLoading) return t("settings.account.openingBilling");
  if (cloudStatusRefreshing) return t("settings.account.checking");
  if (!isSupabaseConfigured || !isCurrentCloudPlan) return t("settings.account.upgrade");
  if (billingEntitlementLockedReason === "device_limit_reached") return t("settings.account.manageBilling");
  if (billingEntitlementStatus === "trialing") return t("settings.account.upgrade");
  if (billingEntitlementStatus === "active") return t("settings.account.manageBilling");
  return t("settings.ai.refreshCloud");
}

function localizedCloudTrialDetail(trialEndsAt: string | null, language: "en" | "ko", t: LocalizationController["t"]): string {
  if (language === "en") return formatCloudTrialStartedDetail(trialEndsAt);
  if (!trialEndsAt) return t("settings.ai.cloudTrialAvailable");
  const endDate = new Date(trialEndsAt);
  if (Number.isNaN(endDate.getTime())) return t("settings.ai.cloudTrialAvailable");
  const date = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(endDate);
  return t("settings.ai.cloudTrialUntil", { date });
}

function maskCloudAccountEmail(email: string | null): string | null {
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) return null;

  const [localPart, domain, ...extraParts] = trimmedEmail.split("@");
  if (!localPart || !domain || extraParts.length > 0) return trimmedEmail;
  return `${localPart.slice(0, Math.min(2, localPart.length))}***@${domain}`;
}
