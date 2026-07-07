import { CloudDeviceManagementPanel } from "../cloud-devices/CloudDeviceManagementPanel";
import type { BillingPlanId } from "../billing/IndividualPlanCards";
import type { BillingEntitlement, BillingInterval } from "../billing/billingService";
import "./AccountSettingsSection.css";

export type AccountSettingsSectionProps = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLockedReason: BillingEntitlement["lockedReason"] | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly billingPortalLoading: boolean;
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
  readonly onEditPublicProfile?: () => void;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onOpenLeaderboard?: () => void;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
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
  onEditPublicProfile,
  onManageCloudBilling,
  onOpenLeaderboard,
  onRefreshCloudStatus,
  onRevokeCloudDevice,
  onSignIn,
  onStartCloudSetup,
}: AccountSettingsSectionProps) {
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
  const accountEmail = isSignedIn ? trimmedUserEmail : "Not signed in";
  const cloudPlanLabel = currentBillingPlan === "individual" || isDeviceLimitLocked ? "Individual" : currentBillingPlan === "free" ? "Free" : "Unknown";
  const cloudStatusCopy = isDeviceLimitLocked
    ? "Device limit reached. Individual includes 2 active Macs; remove an old Mac below to use Cloud AI here."
    : isCurrentCloudPlan
      ? "Drifty Cloud AI is active for this account."
      : "Upgrade to Individual to use hosted Cloud AI on up to 2 active Macs.";

  return (
    <div className="settings-section settings-section--account">
      <div className="settings-block">
        <h3>Account</h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">Signed-in account</div>
            <div className="desc">{accountEmail}</div>
          </div>
          {!isSignedIn ? (
            <div className="ctrl">
              <button type="button" className="settings-btn" onClick={onSignIn}>
                Sign in
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="settings-block">
        <h3>Public profile</h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">{publicProfileDisplayName?.trim() || "Leaderboard profile"}</div>
            <div className="desc">{publicProfileStatus?.trim() || "Shown with your aggregate focus total when you join the leaderboard."}</div>
          </div>
          <div className="ctrl account-public-profile-actions">
            <button type="button" className="settings-btn" onClick={onEditPublicProfile} disabled={!onEditPublicProfile}>
              Edit public profile
            </button>
            <button type="button" className="settings-btn" onClick={onOpenLeaderboard} disabled={!onOpenLeaderboard}>
              Open leaderboard
            </button>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <h3>Drifty Cloud</h3>
        <div className="settings-row settings-row--stacked-action">
          <div>
            <div className="lbl">Plan</div>
            <div className="desc">{cloudStatusCopy}</div>
            {billingEntitlementError ? <p className="capture-recency capture-recency--error" role="status">{billingEntitlementError}</p> : null}
          </div>
          <div className="ctrl">
            <button type="button" className="settings-btn" onClick={() => void cloudAction.onSelect()} disabled={billingPlansDisabled || cloudAction.disabled}>
              {cloudAction.label}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Cloud plan</div>
            <div className="desc">{cloudPlanLabel}</div>
          </div>
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
    </div>
  );
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
