import { canStartCloudTrial, canStartIndividualCheckout } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import type { DeviceSyncStatus } from "../device-sync/deviceSyncTypes";
import { useLocalization } from "../localization/LocalizationContext";
import { DevicesSettingsBlock, type DeviceSyncAccessAction } from "./DevicesSettingsBlock";
import type { HostPlatform } from "../../lib/api/accessibilityClient";

export type SyncSettingsSectionProps = {
  readonly billingEntitlement?: BillingEntitlement | null;
  readonly billingEntitlementError?: string | null;
  readonly cloudDeviceAccess: BillingEntitlement["deviceAccess"] | null;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices?: BillingEntitlement["cloudDevices"];
  readonly cloudStatusRefreshing: boolean;
  readonly hasSignedInAccount?: boolean;
  /** This computer's platform and app version, for the dimmed list preview before it syncs. */
  readonly hostPlatform?: HostPlatform;
  readonly appVersion?: string | null;
  readonly isSupabaseConfigured: boolean;
  readonly userEmail: string | null;
  readonly deviceSyncEnabled?: boolean;
  readonly deviceSyncCanEnable?: boolean;
  readonly deviceSyncGateActive?: boolean;
  readonly deviceSyncStatus?: DeviceSyncStatus;
  readonly deviceSyncPurging?: boolean;
  /** The iPhone turned this computer's sync off and it has not been turned on again. */
  readonly deviceSyncStoppedFromPhone?: boolean;
  /** Present only where device sync is offered. */
  readonly onDeviceSyncEnabledChange?: (enabled: boolean) => void;
  readonly onDeviceSyncNow?: () => void | Promise<void>;
  readonly onPurgeDeviceSyncData?: () => void | Promise<void>;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRevokeCloudDevice: (deviceId: string) => void | Promise<void>;
  readonly onSignIn?: () => void;
  /** Opens the one Pro decision sheet, which routes an available trial to AI setup. */
  readonly onUpgradeToPro?: () => void;
};

/**
 * Settings > Sync: this device's sync switch, the account's device
 * list and the cloud copy, apart from Account's plan and sign-in controls.
 */
export function SyncSettingsSection({
  billingEntitlement = null,
  billingEntitlementError = null,
  cloudDeviceAccess,
  cloudDeviceActionError,
  cloudDeviceRevokingId,
  cloudDevices = [],
  cloudStatusRefreshing,
  hasSignedInAccount,
  hostPlatform = "macos",
  appVersion = null,
  isSupabaseConfigured,
  userEmail,
  deviceSyncEnabled = false,
  deviceSyncCanEnable = false,
  deviceSyncGateActive = false,
  deviceSyncStatus,
  deviceSyncPurging = false,
  deviceSyncStoppedFromPhone = false,
  onDeviceSyncEnabledChange,
  onDeviceSyncNow,
  onPurgeDeviceSyncData,
  onRefreshCloudStatus,
  onRevokeCloudDevice,
  onSignIn,
  onUpgradeToPro,
}: SyncSettingsSectionProps) {
  const { t } = useLocalization();
  const isSignedIn = hasSignedInAccount ?? (userEmail?.trim().length ?? 0) > 0;
  const isDeviceLimitLocked = billingEntitlement?.status === "locked" && billingEntitlement.lockedReason === "device_limit_reached";
  const isDeviceLimitReached = isDeviceLimitLocked
    || (cloudDeviceAccess?.allowed === false && cloudDeviceAccess.reason === "device_limit_reached");
  const showDeviceList = billingEntitlement?.status === "active" || isDeviceLimitLocked || (cloudDevices?.length ?? 0) > 0;

  // Account's sign-in and plan controls are a section away, so a switch that
  // cannot turn on says what would let it: sign in, or get Pro access. Payment
  // recovery, a full device limit and organization seats keep their own paths.
  let accessAction: DeviceSyncAccessAction | null = null;
  const syncBlocked = Boolean(onDeviceSyncEnabledChange) && !deviceSyncEnabled && !deviceSyncCanEnable && !isDeviceLimitReached;
  if (syncBlocked && !isSignedIn) {
    accessAction = isSupabaseConfigured && onSignIn ? { label: t("settings.account.signIn"), onClick: onSignIn } : null;
  } else if (syncBlocked && onUpgradeToPro && !billingEntitlementError && !cloudStatusRefreshing
    && billingEntitlement?.status === "locked" && billingEntitlement.entitlementOwner !== "organization"
    && canStartIndividualCheckout(billingEntitlement)) {
    accessAction = {
      label: canStartCloudTrial(billingEntitlement) ? t("billing.trialActivation.start") : t("billing.plan.proCta"),
      onClick: onUpgradeToPro,
    };
  }

  return (
    <div className="settings-section settings-section--sync">
      <DevicesSettingsBlock
        isSignedIn={isSignedIn}
        deviceLimitReached={isDeviceLimitReached}
        showDeviceList={showDeviceList}
        cloudDeviceAccess={cloudDeviceAccess}
        cloudDeviceActionError={cloudDeviceActionError}
        cloudDeviceRevokingId={cloudDeviceRevokingId}
        cloudDevices={cloudDevices}
        cloudStatusRefreshing={cloudStatusRefreshing}
        deviceSyncEnabled={deviceSyncEnabled}
        deviceSyncCanEnable={deviceSyncCanEnable}
        deviceSyncGateActive={deviceSyncGateActive}
        deviceSyncStatus={deviceSyncStatus}
        deviceSyncPurging={deviceSyncPurging}
        deviceSyncStoppedFromPhone={deviceSyncStoppedFromPhone}
        accessAction={accessAction}
        previewDevice={{ platform: hostPlatform === "windows" ? "windows" : "macos", appVersion }}
        onDeviceSyncEnabledChange={onDeviceSyncEnabledChange}
        onDeviceSyncNow={onDeviceSyncNow}
        onPurgeDeviceSyncData={onPurgeDeviceSyncData}
        onRefreshCloudStatus={onRefreshCloudStatus}
        onRevokeCloudDevice={onRevokeCloudDevice}
      />
    </div>
  );
}
