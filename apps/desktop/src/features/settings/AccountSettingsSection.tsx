import { CloudDeviceManagementPanel } from "../cloud-devices/CloudDeviceManagementPanel";
import { Toggle } from "../../components/Toggle";
import { IndividualPlanCards, type BillingPlanId } from "../billing/IndividualPlanCards";
import { TrialCouponRedemption } from "./TrialCouponRedemption";
import type {
  BillingEntitlement,
  BillingInterval,
  CouponRedemption,
  CouponRedemptionFailureCode,
} from "../billing/billingService";
import type { DeviceSyncStatus } from "../device-sync/deviceSyncTypes";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import "./AccountSettingsSection.css";

export type AccountSettingsSectionProps = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLockedReason: BillingEntitlement["lockedReason"] | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly billingPortalLoading: boolean;
  readonly couponRedemption: CouponRedemption | null;
  readonly couponRedemptionErrorCode: CouponRedemptionFailureCode | null;
  readonly couponRedemptionLoading: boolean;
  readonly cloudDeviceAccess: BillingEntitlement["deviceAccess"] | null;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices: BillingEntitlement["cloudDevices"];
  readonly cloudStatusRefreshing: boolean;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly isSupabaseConfigured: boolean;
  readonly publicProfileDisplayName?: string | null;
  readonly publicProfileStatus?: string | null;
  readonly shouldShowCloudCheckoutPlans: boolean;
  readonly userEmail: string | null;
  readonly deviceSyncEnabled?: boolean;
  readonly deviceSyncGateActive?: boolean;
  readonly deviceSyncStatus?: DeviceSyncStatus;
  readonly deviceSyncPurging?: boolean;
  readonly onDeviceSyncEnabledChange?: (enabled: boolean) => void;
  readonly onDeviceSyncNow?: () => void | Promise<void>;
  readonly onPurgeDeviceSyncData?: () => void | Promise<void>;
  readonly onEditPublicProfile?: () => void;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onOpenAiSetup?: () => void;
  readonly onOpenLeaderboard?: () => void;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRedeemTrialCoupon: (code: string) => void | Promise<void>;
  readonly onRevokeCloudDevice: (deviceId: string) => void | Promise<void>;
  readonly onSignIn: () => void;
  readonly onStartCloudSetup: (billingInterval: BillingInterval) => void | Promise<void>;
};

export function AccountSettingsSection({
  billingCheckoutLoadingInterval,
  billingEntitlementError,
  billingEntitlementLockedReason,
  billingEntitlementStatus,
  billingPlansDisabled,
  billingPortalLoading,
  couponRedemption,
  couponRedemptionErrorCode,
  couponRedemptionLoading,
  cloudDeviceAccess,
  cloudDeviceActionError,
  cloudDeviceRevokingId,
  cloudDevices = [],
  cloudStatusRefreshing,
  currentBillingPlan,
  isSupabaseConfigured,
  publicProfileDisplayName,
  publicProfileStatus,
  shouldShowCloudCheckoutPlans,
  userEmail,
  deviceSyncEnabled = false,
  deviceSyncGateActive = false,
  deviceSyncStatus,
  deviceSyncPurging = false,
  onDeviceSyncEnabledChange,
  onDeviceSyncNow,
  onPurgeDeviceSyncData,
  onEditPublicProfile,
  onManageCloudBilling,
  onOpenAiSetup,
  onOpenLeaderboard,
  onRefreshCloudStatus,
  onRedeemTrialCoupon,
  onRevokeCloudDevice,
  onSignIn,
  onStartCloudSetup,
}: AccountSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const isDeviceLimitLocked = billingEntitlementStatus === "locked" && billingEntitlementLockedReason === "device_limit_reached";
  const isPaymentRequiredLocked = billingEntitlementStatus === "locked" && billingEntitlementLockedReason === "payment_required";
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const shouldShowDeviceManagement = isCurrentCloudPlan || isDeviceLimitLocked || cloudDevices.length > 0;
  // During a trial the plan is not owned yet: the cards must stay purchasable so
  // the user can convert, instead of reading as "Current plan" and locking.
  const planCardsCurrentPlan = billingEntitlementStatus === "trialing" ? "free" : currentBillingPlan;
  // The Pro card already names the plan a subscriber owns, so it also
  // carries billing management. That removes the separate status row that would
  // otherwise repeat the same plan name directly under the same card.
  const canManageCurrentPlan = isCurrentCloudPlan || billingEntitlementStatus === "active" || isDeviceLimitLocked || isPaymentRequiredLocked;
  const trimmedUserEmail = userEmail?.trim() ?? "";
  const isSignedIn = trimmedUserEmail.length > 0;
  const accountEmail = isSignedIn ? trimmedUserEmail : t("settings.account.notSignedIn");

  const planCards = (
    <div className="settings-row settings-row--cloud-pricing">
      <IndividualPlanCards
        currentPlan={planCardsCurrentPlan}
        disabled={billingPlansDisabled}
        loadingInterval={billingCheckoutLoadingInterval}
        manageCurrentPlanLabel={isPaymentRequiredLocked ? t("settings.account.fixBilling") : undefined}
        manageCurrentPlanLoading={billingPortalLoading}
        mode="display"
        onManageCurrentPlan={canManageCurrentPlan ? () => void onManageCloudBilling() : undefined}
        onSelectFreePlan={onOpenAiSetup}
        onSelectPlan={(interval) => {
          void onStartCloudSetup(interval);
        }}
      />
    </div>
  );

  return (
    <div className="settings-section settings-section--account">
      {/* Plans lead the page in every state: the card names the plan, states the
          price, and carries either the purchase or billing management. */}
      <div className="settings-block settings-block--plans">
        <h3>{t("settings.section.account")}</h3>
        {isDeviceLimitLocked || isPaymentRequiredLocked || billingEntitlementError ? (
          <div className="account-plan-notice" role="status">
            {isDeviceLimitLocked ? <p>{t("settings.account.deviceLimit")}</p> : null}
            {isPaymentRequiredLocked ? <p>{t("settings.account.paymentRequired")}</p> : null}
            {billingEntitlementError ? <p className="account-plan-notice__error">{localizeSettingsError(billingEntitlementError, effectiveLanguage, t)}</p> : null}
          </div>
        ) : null}
        {planCards}
      </div>

      <TrialCouponRedemption
        disabled={billingPlansDisabled || !isSupabaseConfigured || !isSignedIn}
        errorCode={couponRedemptionErrorCode}
        isSignedIn={isSignedIn}
        loading={couponRedemptionLoading}
        redemption={couponRedemption}
        onRedeem={onRedeemTrialCoupon}
      />

      <div className="settings-block settings-block--cloud-account">
        <h3>{t("settings.account.signedIn")}</h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">{accountEmail}</div>
          </div>
          {!isSignedIn ? (
            <div className="ctrl">
              <button type="button" className="settings-btn" onClick={onSignIn}>
                {t("settings.account.signIn")}
              </button>
            </div>
          ) : null}
        </div>
        {shouldShowDeviceManagement ? (
          <div className="settings-row settings-row--cloud-devices">
            <CloudDeviceManagementPanel
              access={cloudDeviceAccess}
              actionError={cloudDeviceActionError}
              devices={cloudDevices}
              isRefreshing={cloudStatusRefreshing}
              revokingId={cloudDeviceRevokingId}
              onRefresh={onRefreshCloudStatus}
              onRevoke={onRevokeCloudDevice}
            />
          </div>
        ) : null}
      </div>

      <div className="settings-block">
        <h3 className="settings-block__title-with-badge" aria-label={t("settings.account.publicProfile")}>
          <span>{t("settings.account.publicProfile")}</span>
          <span className="settings-beta-badge">{t("common.beta")}</span>
        </h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">{publicProfileDisplayName?.trim() || t("settings.account.leaderboardProfile")}</div>
            <div className="desc">{publicProfileStatus?.trim() || t("settings.account.profileDescription")}</div>
          </div>
          <div className="ctrl account-public-profile-actions">
            <button type="button" className="settings-btn" onClick={onEditPublicProfile} disabled={!onEditPublicProfile}>
              {t("settings.account.editProfile")}
            </button>
            <button type="button" className="settings-btn" onClick={onOpenLeaderboard} disabled={!onOpenLeaderboard}>
              {t("settings.account.openLeaderboard")}
            </button>
          </div>
        </div>
      </div>

      {onDeviceSyncEnabledChange ? (
        <div className="settings-block">
          <h3>{t("settings.account.deviceSync")}</h3>
          <div className="settings-row">
            <div>
              <div className="lbl">{t("settings.account.syncMacs")}</div>
              <div className="desc">{t("settings.account.syncDescription")}</div>
              {!deviceSyncGateActive && deviceSyncEnabled ? (
                <p className="capture-recency capture-recency--error" role="status">
                  {t("settings.account.syncPaused")}
                </p>
              ) : null}
              {deviceSyncStatus?.lastError ? (
                <p className="capture-recency capture-recency--error" role="status">{localizeSettingsError(deviceSyncStatus.lastError, effectiveLanguage, t)}</p>
              ) : null}
            </div>
            <div className="ctrl">
              <Toggle
                checked={deviceSyncEnabled}
                onChange={onDeviceSyncEnabledChange}
                ariaLabel={t("settings.account.toggleSync")}
              />
            </div>
          </div>
          {deviceSyncEnabled ? (
            <div className="settings-row settings-row--stacked-action">
              <div>
                <div className="lbl">{t("settings.account.syncStatus")}</div>
                <div className="desc">{describeDeviceSyncStatus(deviceSyncStatus, t)}</div>
              </div>
              <div className="ctrl account-public-profile-actions">
                <button type="button" className="settings-btn" onClick={() => void onDeviceSyncNow?.()} disabled={!onDeviceSyncNow || !deviceSyncGateActive}>
                  {t("settings.account.syncNow")}
                </button>
                <button
                  type="button"
                  className="settings-btn danger"
                  onClick={() => void onPurgeDeviceSyncData?.()}
                  disabled={!onPurgeDeviceSyncData || deviceSyncPurging}
                >
                  {deviceSyncPurging ? t("settings.account.deleting") : t("settings.account.deleteCloud")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function describeDeviceSyncStatus(status: DeviceSyncStatus | undefined, t: LocalizationController["t"]): string {
  if (!status || !status.enabled) return t("settings.account.syncWaiting");
  const parts: string[] = [];
  if (status.backfill && status.backfill.pushedSeq < status.backfill.totalSeq) {
    const percent = status.backfill.totalSeq > 0
      ? Math.min(100, Math.floor((status.backfill.pushedSeq / status.backfill.totalSeq) * 100))
      : 0;
    parts.push(t("settings.account.syncUploading", { percent }));
  }
  if (status.lastPushedAt) parts.push(t("settings.account.lastUpload", { time: formatSyncTimestamp(status.lastPushedAt) }));
  if (status.lastPulledAt) parts.push(t("settings.account.lastDownload", { time: formatSyncTimestamp(status.lastPulledAt) }));
  if (parts.length === 0) return t("settings.account.syncWaiting");
  return parts.join(" · ");
}

function formatSyncTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
