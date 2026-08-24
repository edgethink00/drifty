import { CloudDeviceManagementPanel } from "../cloud-devices/CloudDeviceManagementPanel";
import { Toggle } from "../../components/Toggle";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
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
  readonly onOpenLeaderboard?: () => void;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRedeemTrialCoupon: (code: string) => void | Promise<void>;
  readonly onRevokeCloudDevice: (deviceId: string) => void | Promise<void>;
  readonly onSignIn: () => void;
  readonly onStartCloudSetup: (billingInterval?: BillingInterval) => void | Promise<void>;
};

type CloudAccountAction = {
  readonly disabled: boolean;
  readonly label: string;
  readonly onSelect: () => void | Promise<unknown>;
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
  onOpenLeaderboard,
  onRefreshCloudStatus,
  onRedeemTrialCoupon,
  onRevokeCloudDevice,
  onSignIn,
  onStartCloudSetup,
}: AccountSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const isDeviceLimitLocked = billingEntitlementStatus === "locked" && billingEntitlementLockedReason === "device_limit_reached";
  const isCurrentCloudPlan = currentBillingPlan === "individual" && !shouldShowCloudCheckoutPlans;
  const shouldShowDeviceManagement = isCurrentCloudPlan || isDeviceLimitLocked || cloudDevices.length > 0;
  const cloudAction = resolveCloudAccountAction({
    billingCheckoutLoadingInterval,
    billingEntitlementLockedReason,
    billingEntitlementStatus,
    billingPortalLoading,
    cloudStatusRefreshing,
    isCurrentCloudPlan,
    isSupabaseConfigured,
    onManageCloudBilling,
    onRefreshCloudStatus,
    onStartCloudSetup,
  });
  const trimmedUserEmail = userEmail?.trim() ?? "";
  const isSignedIn = trimmedUserEmail.length > 0;
  const accountEmail = isSignedIn ? trimmedUserEmail : t("settings.account.notSignedIn");
  const cloudPlanLabel = currentBillingPlan === "individual" || isDeviceLimitLocked ? t("settings.account.individual") : currentBillingPlan === "free" ? t("settings.account.free") : t("settings.data.unknown");
  const cloudStatusCopy = isDeviceLimitLocked
    ? t("settings.account.deviceLimit")
    : isCurrentCloudPlan
      ? t("settings.account.cloudActive")
      : t("settings.account.cloudUpgrade");

  return (
    <div className="settings-section settings-section--account">
      <div className="settings-block">
        <h3>{t("settings.section.account")}</h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">{t("settings.account.signedIn")}</div>
            <div className="desc">{accountEmail}</div>
          </div>
          {!isSignedIn ? (
            <div className="ctrl">
              <button type="button" className="settings-btn" onClick={onSignIn}>
                {t("settings.account.signIn")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="settings-block">
        <h3>{t("settings.account.publicProfile")}</h3>
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

      <div className="settings-block">
        <h3>Drifty Cloud</h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">{t("settings.account.plan")}</div>
            <div className="desc">{cloudStatusCopy}</div>
            {billingEntitlementError ? <p className="capture-recency capture-recency--error" role="status">{localizeSettingsError(billingEntitlementError, effectiveLanguage, t)}</p> : null}
          </div>
          <div className="ctrl">
            <button type="button" className="settings-btn" onClick={() => void cloudAction.onSelect()} disabled={billingPlansDisabled || cloudAction.disabled}>
              {translateCloudActionLabel(cloudAction.label, t)}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.account.cloudPlan")}</div>
            <div className="desc">{cloudPlanLabel}</div>
          </div>
        </div>
        <TrialCouponRedemption
          disabled={billingPlansDisabled || !isSupabaseConfigured || !isSignedIn}
          errorCode={couponRedemptionErrorCode}
          isSignedIn={isSignedIn}
          loading={couponRedemptionLoading}
          redemption={couponRedemption}
          onRedeem={onRedeemTrialCoupon}
        />
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

function translateCloudActionLabel(label: string, t: LocalizationController["t"]): string {
  switch (label) {
    case "Opening billing...": return t("settings.account.openingBilling");
    case "Opening checkout...": return t("settings.account.openingCheckout");
    case "Checking...": return t("settings.account.checking");
    case "Upgrade to Individual": return t("settings.account.upgrade");
    case "Manage billing": return t("settings.account.manageBilling");
    default: return label;
  }
}

function resolveCloudAccountAction({
  billingCheckoutLoadingInterval,
  billingEntitlementLockedReason,
  billingEntitlementStatus,
  billingPortalLoading,
  cloudStatusRefreshing,
  isCurrentCloudPlan,
  isSupabaseConfigured,
  onManageCloudBilling,
  onRefreshCloudStatus,
  onStartCloudSetup,
}: {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementLockedReason: BillingEntitlement["lockedReason"] | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPortalLoading: boolean;
  readonly cloudStatusRefreshing: boolean;
  readonly isCurrentCloudPlan: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onStartCloudSetup: (billingInterval?: BillingInterval) => void | Promise<void>;
}): CloudAccountAction {
  if (billingPortalLoading) return { disabled: true, label: "Opening billing...", onSelect: onManageCloudBilling };
  if (billingCheckoutLoadingInterval !== null) return { disabled: true, label: "Opening checkout...", onSelect: () => onStartCloudSetup() };
  if (cloudStatusRefreshing) return { disabled: true, label: "Checking...", onSelect: onRefreshCloudStatus };
  if (!isSupabaseConfigured || billingEntitlementStatus === "trialing") return { disabled: false, label: "Upgrade to Individual", onSelect: () => onStartCloudSetup() };
  if (isCurrentCloudPlan || billingEntitlementLockedReason === "device_limit_reached") return { disabled: false, label: "Manage billing", onSelect: onManageCloudBilling };
  return { disabled: false, label: "Upgrade to Individual", onSelect: () => onStartCloudSetup() };
}
