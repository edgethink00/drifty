import { useRef, useState } from "react";
import { canOfferPromoCode, canStartCloudTrial } from "../billing/billingEligibility";
import { CloudDeviceManagementPanel } from "../cloud-devices/CloudDeviceManagementPanel";
import { DeviceSyncSetupModal } from "../device-sync/DeviceSyncSetupModal";
import { Toggle } from "../../components/Toggle";
import { formatOrganizationSeatAccessCopy } from "../billing/billingAccessCopy";
import {
  dissolveOwnOrganization,
  releaseOwnOrganizationSeat,
  type OrganizationDissolveResult,
  type OrganizationSeatReleaseResult,
} from "../billing/organizationSeatService";
import { resolveOrganizationSeatDisplay, resolvePlanCardState, type OrganizationSeatDisplay } from "../billing/planCardState";
import { TrialCouponRedemption } from "./TrialCouponRedemption";
import { FriendInviteCard } from "./FriendInviteCard";
import { friendInviteAccountKey } from "./friendInviteStore";
import type {
  BillingEntitlement,
  BillingInterval,
  CouponRedemption,
  CouponRedemptionFailureCode,
  FriendInviteResult,
} from "../billing/billingService";
import type { DeviceSyncStatus } from "../device-sync/deviceSyncTypes";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import "./AccountSettingsSection.css";
import { ActionLabel } from "../../components/ActionLabel";

export const ORGANIZATION_SEAT_MANAGEMENT_URL = "https://drifty.so/account/organization";

export type AccountSettingsSectionProps = {
  readonly billingCheckoutAwaitingConfirmation?: boolean;
  readonly billingActionError?: string | null;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlement?: BillingEntitlement | null;
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
  readonly hasAuthenticatedSession?: boolean;
  readonly hasSignedInAccount?: boolean;
  readonly isSupabaseConfigured: boolean;
  /** Reads the account's friend invite. Without it the gift row is not offered. */
  readonly loadFriendInvite?: () => Promise<FriendInviteResult>;
  readonly userEmail: string | null;
  readonly authUserId?: string | null;
  readonly deviceSyncEnabled?: boolean;
  readonly deviceSyncCanEnable?: boolean;
  readonly deviceSyncGateActive?: boolean;
  readonly deviceSyncStatus?: DeviceSyncStatus;
  readonly deviceSyncPurging?: boolean;
  readonly onDeviceSyncEnabledChange?: (enabled: boolean) => void;
  readonly onDeviceSyncNow?: () => void | Promise<void>;
  readonly onPurgeDeviceSyncData?: () => void | Promise<void>;
  readonly onDeleteAccount?: () => void;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onOpenAiSetup?: () => void;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRedeemTrialCoupon: (code: string) => void | Promise<void>;
  readonly onReleaseOrganizationSeat?: (seatId: string) => Promise<OrganizationSeatReleaseResult>;
  readonly onDissolveOrganization?: () => Promise<OrganizationDissolveResult>;
  readonly onRevokeCloudDevice: (deviceId: string) => void | Promise<void>;
  readonly onSignIn: () => void;
  /** Opens the one Pro decision sheet (or sign-in first); see ProDecisionSheet. */
  readonly onUpgradeToPro?: () => void;
};

export function AccountSettingsSection({
  billingCheckoutAwaitingConfirmation = false,
  billingActionError = null,
  billingCheckoutLoadingInterval,
  billingEntitlement = null,
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
  hasAuthenticatedSession,
  hasSignedInAccount,
  isSupabaseConfigured,
  loadFriendInvite,
  userEmail,
  authUserId,
  deviceSyncEnabled = false,
  deviceSyncCanEnable = false,
  deviceSyncGateActive = false,
  deviceSyncStatus,
  deviceSyncPurging = false,
  onDeviceSyncEnabledChange,
  onDeviceSyncNow,
  onPurgeDeviceSyncData,
  onDeleteAccount,
  onManageCloudBilling,
  onOpenAiSetup,
  onRefreshCloudStatus,
  onRedeemTrialCoupon,
  onReleaseOrganizationSeat = releaseOwnOrganizationSeat,
  onDissolveOrganization = dissolveOwnOrganization,
  onRevokeCloudDevice,
  onSignIn,
  onUpgradeToPro,
}: AccountSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [couponSurface, setCouponSurface] = useState<"plan" | "invite">("plan");
  const [syncSetupMode, setSyncSetupMode] = useState<"info" | "enable" | null>(null);
  const [localActionPending, setLocalActionPending] = useState(false);
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const organizationOpeningRef = useRef(false);
  const [organizationOpening, setOrganizationOpening] = useState(false);
  const [organizationOpenError, setOrganizationOpenError] = useState(false);
  const seatReleaseInFlight = useRef(false);
  const [seatReleaseConfirming, setSeatReleaseConfirming] = useState(false);
  const [seatReleaseWorking, setSeatReleaseWorking] = useState(false);
  const [seatReleaseNotice, setSeatReleaseNotice] = useState<"pending" | "refused" | "failed" | null>(null);
  const dissolveInFlight = useRef(false);
  const [dissolveConfirming, setDissolveConfirming] = useState(false);
  const [dissolveWorking, setDissolveWorking] = useState(false);
  const [dissolveNameInput, setDissolveNameInput] = useState("");
  const [dissolveNotice, setDissolveNotice] = useState<"pending" | "refused" | "failed" | null>(null);
  const planActionBusy = localActionPending || billingCheckoutLoadingInterval !== null || billingPortalLoading;
  const runBillingAction = async (action: () => void | Promise<void>) => {
    if (actionInFlight.current || planActionBusy || billingPlansDisabled) return;
    actionInFlight.current = true;
    setLocalActionPending(true);
    setLocalActionError(null);
    try { await action(); }
    catch { setLocalActionError(t("settings.account.billingActionFailed")); }
    finally { actionInFlight.current = false; setLocalActionPending(false); }
  };
  const openOrganizationSeatManagement = async () => {
    if (organizationOpeningRef.current) return;
    organizationOpeningRef.current = true;
    setOrganizationOpening(true);
    setOrganizationOpenError(false);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(ORGANIZATION_SEAT_MANAGEMENT_URL);
    } catch {
      setOrganizationOpenError(true);
    } finally {
      organizationOpeningRef.current = false;
      setOrganizationOpening(false);
    }
  };
  const releaseOrganizationSeat = async (seatId: string) => {
    if (seatReleaseInFlight.current) return;
    seatReleaseInFlight.current = true;
    setSeatReleaseWorking(true);
    setSeatReleaseNotice(null);
    try {
      const result = await onReleaseOrganizationSeat(seatId);
      if (result.outcome === "released") {
        setSeatReleaseConfirming(false);
        // The seat surface is derived from the entitlement, so it only
        // disappears once the refreshed entitlement says the seat is gone.
        await onRefreshCloudStatus();
        return;
      }
      setSeatReleaseNotice(result.outcome === "pending" ? "pending" : result.outcome === "refused" ? "refused" : "failed");
    } catch {
      setSeatReleaseNotice("failed");
    } finally {
      seatReleaseInFlight.current = false;
      setSeatReleaseWorking(false);
    }
  };
  const dissolveOrganization = async () => {
    if (dissolveInFlight.current) return;
    dissolveInFlight.current = true;
    setDissolveWorking(true);
    setDissolveNotice(null);
    try {
      const result = await onDissolveOrganization();
      if (result.outcome === "dissolved") {
        setDissolveConfirming(false);
        setDissolveNameInput("");
        // The organization surface is derived from the entitlement, so it only
        // disappears once the refreshed entitlement agrees it is gone.
        await onRefreshCloudStatus();
        return;
      }
      setDissolveNotice(result.outcome === "pending" ? "pending" : result.outcome === "refused" ? "refused" : "failed");
    } catch {
      setDissolveNotice("failed");
    } finally {
      dissolveInFlight.current = false;
      setDissolveWorking(false);
    }
  };
  const isDeviceLimitLocked = billingEntitlementStatus === "locked" && billingEntitlementLockedReason === "device_limit_reached";
  const isPaymentRequiredLocked = billingEntitlementStatus === "locked" && billingEntitlementLockedReason === "payment_required";
  const isCurrentCloudPlan = billingEntitlementStatus === "active";
  const organizationSeat = resolveOrganizationSeatDisplay(billingEntitlement);
  const organizationSeatCopy = organizationSeat
    ? formatOrganizationSeatAccessCopy(organizationSeat.organizationName, effectiveLanguage)
    : null;
  const shouldShowDeviceManagement = isCurrentCloudPlan || isDeviceLimitLocked || cloudDevices.length > 0;
  // A trial holds Pro access without owning the subscription. Passing the real
  // state (instead of relabelling the account as Free) keeps Pro purchasable
  // while the cards still say the trial is what is currently running.
  const planState = resolvePlanCardState(
    billingEntitlementStatus === null
      ? null
      : {
        plan: "individual",
        status: billingEntitlementStatus,
        canUseApp: billingEntitlementStatus !== "locked",
        trialEndsAt: null,
        currentPeriodEnd: null,
        lockedReason: billingEntitlementLockedReason ?? undefined,
      },
  );
  const isTrialing = planState === "pro_trial";
  const trialAvailable = canStartCloudTrial(billingEntitlement)
    && !billingEntitlementError && !cloudStatusRefreshing;
  // A subscription (or one blocked by payment or the device limit) is managed in the billing portal.
  const canManageCurrentPlan = isCurrentCloudPlan || isDeviceLimitLocked || isPaymentRequiredLocked;
  const trimmedUserEmail = userEmail?.trim() ?? "";
  const isSignedIn = hasSignedInAccount ?? trimmedUserEmail.length > 0;
  const planStatusUnknown = isSignedIn && isSupabaseConfigured && billingEntitlementStatus === null;
  const planNeedsRefresh = planStatusUnknown || Boolean(billingEntitlementError);
  const upgradeDisabled = billingPlansDisabled || planActionBusy || planNeedsRefresh || cloudStatusRefreshing;
  const actionError = localActionError ?? billingActionError;
  const billingProgress = billingCheckoutAwaitingConfirmation
    ? t("settings.account.checkoutPending")
    : planActionBusy ? t("settings.account.billingOpening") : null;
  const canDeleteAccount = hasAuthenticatedSession ?? isSignedIn;
  const accountEmail = trimmedUserEmail || (isSignedIn
    ? t("settings.account.signedInWithoutEmail")
    : t("settings.account.notSignedIn"));
  // Settings search reads the same rule, so it never points at a hidden row.
  const showPromoCode = canOfferPromoCode(billingEntitlementStatus === null ? billingEntitlement : {
    status: billingEntitlementStatus,
    lockedReason: billingEntitlementLockedReason ?? undefined,
    entitlementOwner: billingEntitlement?.entitlementOwner,
  });
  const activePromotionEndsAt = billingEntitlement?.status === "trialing" && billingEntitlement.accessSource === "promotion"
    ? billingEntitlement.trialEndsAt
    : null;
  // Promo code and the friend invite's code tab share one redemption. The
  // applied result shows in both; an attempt's progress and error stay with
  // the control the user typed into.
  const redeemFrom = (surface: "plan" | "invite") => (code: string) => {
    setCouponSurface(surface);
    return onRedeemTrialCoupon(code);
  };
  const couponEntryFor = (surface: "plan" | "invite") => ({
    activePromotionEndsAt,
    disabled: billingPlansDisabled || !isSupabaseConfigured || !isSignedIn,
    errorCode: couponSurface === surface ? couponRedemptionErrorCode : null,
    isSignedIn,
    loading: couponSurface === surface && couponRedemptionLoading,
    redemption: couponRedemption,
    onRedeem: redeemFrom(surface),
    onSignIn,
  });
  const planCouponEntry = couponEntryFor("plan");

  return (
    <div className="settings-section settings-section--account">
      {/* Account shows current access and one action for it: start a trial, upgrade, manage billing, or manage seats. */}
      <div data-setting-id="settings.section.account" className="settings-block settings-block--plans">
        <h3>{t("settings.section.account")}</h3>
        {isDeviceLimitLocked || isPaymentRequiredLocked || actionError ? (
          <div className="account-plan-notice" role="status">
            {isDeviceLimitLocked ? <p>{t("settings.account.deviceLimit")}</p> : null}
            {isPaymentRequiredLocked ? <p>{t("settings.account.paymentRequired")}</p> : null}
            {actionError ? <p className="account-plan-notice__error">{localizeSettingsError(actionError, effectiveLanguage, t)}</p> : null}
          </div>
        ) : null}
        <div className="settings-row account-plan-summary">
          <div>
            <div className="lbl">{trialAvailable ? t("billing.trialActivation.available") : organizationSeatCopy ? organizationSeatCopy.title : planStatusUnknown ? t("settings.ai.status.checking") : isTrialing || canManageCurrentPlan ? t("billing.plan.pro") : t("billing.plan.free")}</div>
            <div className="desc">{trialAvailable ? t("billing.trialActivation.availableBody") : organizationSeat && organizationSeatCopy
              ? [organizationSeatCopy.summary, t("settings.account.organizationRole", { role: organizationRoleLabel(organizationSeat.role, t) })].join(" ")
              : planStatusUnknown ? "" : isTrialing
                ? t("billing.plan.trialBadge")
                : planState === "trial_expired"
                  ? t("settings.account.trialEndedSummary")
                  : canManageCurrentPlan
                    ? t("settings.account.proSummary")
                    : t("settings.account.freeSummary")}</div>
          </div>
          <div className="ctrl account-plan-summary__actions">
            {trialAvailable && onOpenAiSetup ? <button type="button" className="settings-btn primary" onClick={onOpenAiSetup}>{t("sidebar.cta.ai.action")}</button> : null}
            {!trialAvailable && !organizationSeat && !canManageCurrentPlan && onUpgradeToPro ? (
              <button type="button" className="settings-btn primary" aria-haspopup="dialog" disabled={upgradeDisabled} onClick={onUpgradeToPro}>
                {t("billing.plan.proCta")}
              </button>
            ) : null}
            {canManageCurrentPlan && !organizationSeat ? (
              <button type="button" className="settings-btn primary" disabled={planActionBusy || billingPlansDisabled} aria-busy={billingPortalLoading}
                onClick={() => void runBillingAction(onManageCloudBilling)}>
                <ActionLabel busy={billingPortalLoading} busyLabel={t("billing.plan.openingBilling")}>{isPaymentRequiredLocked ? t("settings.account.fixBilling") : t("billing.plan.manageBilling")}</ActionLabel>
              </button>
            ) : null}
            {organizationSeat?.canManageSeats ? (
              <button type="button" className="settings-btn" disabled={organizationOpening}
                aria-busy={organizationOpening}
                onClick={() => void openOrganizationSeatManagement()}>
                {t("settings.account.manageSeats")}
              </button>
            ) : null}
          </div>
        </div>
        {showPromoCode ? (
          <TrialCouponRedemption
            activePromotionEndsAt={planCouponEntry.activePromotionEndsAt}
            disabled={planCouponEntry.disabled}
            errorCode={planCouponEntry.errorCode}
            isSignedIn={planCouponEntry.isSignedIn}
            loading={planCouponEntry.loading}
            redemption={planCouponEntry.redemption}
            onRedeem={planCouponEntry.onRedeem}
            onSignIn={planCouponEntry.onSignIn}
          />
        ) : null}
        {organizationSeat && organizationSeat.role !== "owner" ? (
          <div className="settings-row account-organization-seat-release">
            <div>
              <div className="lbl">{t("settings.account.releaseSeatTitle")}</div>
              <div className="desc">
                {t(seatReleaseConfirming
                  ? "settings.account.releaseSeatConfirmDescription"
                  : "settings.account.releaseSeatDescription")}
              </div>
            </div>
            <div className="ctrl account-plan-summary__actions">
              {seatReleaseConfirming ? (
                <>
                  <button type="button" className="settings-btn danger"
                    disabled={seatReleaseWorking} aria-busy={seatReleaseWorking}
                    onClick={() => void releaseOrganizationSeat(organizationSeat.seatId)}>
                    {seatReleaseWorking
                      ? t("settings.account.releaseSeatWorking")
                      : t("settings.account.releaseSeatConfirm")}
                  </button>
                  <button type="button" className="settings-btn" disabled={seatReleaseWorking}
                    onClick={() => { setSeatReleaseConfirming(false); setSeatReleaseNotice(null); }}>
                    {t("settings.account.releaseSeatCancel")}
                  </button>
                </>
              ) : (
                <button type="button" className="settings-btn"
                  onClick={() => { setSeatReleaseConfirming(true); setSeatReleaseNotice(null); }}>
                  {t("settings.account.releaseSeat")}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {seatReleaseNotice ? (
          <p className="account-plan-notice__error" role="alert">
            {t(seatReleaseNotice === "pending"
              ? "settings.account.releaseSeatPending"
              : seatReleaseNotice === "refused"
                ? "settings.account.releaseSeatRefused"
                : "settings.account.releaseSeatFailed")}
          </p>
        ) : null}
        {organizationSeat && organizationSeat.role === "owner" ? (
          <div className="settings-row account-organization-dissolve">
            <div>
              <div className="lbl">{t("settings.account.dissolveTitle")}</div>
              <div className="desc">
                {t(dissolveConfirming
                  ? "settings.account.dissolveConfirmDescription"
                  : "settings.account.dissolveDescription")}
              </div>
              {dissolveConfirming ? (
                <input
                  className="settings-input"
                  type="text"
                  value={dissolveNameInput}
                  disabled={dissolveWorking}
                  onChange={(event) => setDissolveNameInput(event.target.value)}
                  placeholder={t("settings.account.dissolveNamePlaceholder")}
                  aria-label={t("settings.account.dissolveNamePlaceholder")}
                />
              ) : null}
            </div>
            <div className="ctrl account-plan-summary__actions">
              {dissolveConfirming ? (
                <>
                  <button type="button" className="settings-btn danger"
                    disabled={dissolveWorking || dissolveNameInput.trim() !== organizationSeat.organizationName.trim()}
                    aria-busy={dissolveWorking}
                    onClick={() => void dissolveOrganization()}>
                    {dissolveWorking
                      ? t("settings.account.dissolveWorking")
                      : t("settings.account.dissolveConfirm")}
                  </button>
                  <button type="button" className="settings-btn" disabled={dissolveWorking}
                    onClick={() => { setDissolveConfirming(false); setDissolveNameInput(""); setDissolveNotice(null); }}>
                    {t("settings.account.dissolveCancel")}
                  </button>
                </>
              ) : (
                <button type="button" className="settings-btn"
                  onClick={() => { setDissolveConfirming(true); setDissolveNotice(null); }}>
                  {t("settings.account.dissolve")}
                </button>
              )}
            </div>
          </div>
        ) : null}
        {dissolveNotice ? (
          <p className="account-plan-notice__error" role="alert">
            {t(dissolveNotice === "pending"
              ? "settings.account.dissolvePending"
              : dissolveNotice === "refused"
                ? "settings.account.dissolveRefused"
                : "settings.account.dissolveFailed")}
          </p>
        ) : null}
      </div>

      {billingProgress ? <p className="account-plan-progress" role="status">{billingProgress}</p> : null}
      {organizationOpenError ? <p className="account-plan-progress" role="alert">{t("settings.account.organizationOpenFailed")}</p> : null}

      <div data-setting-id="settings.account.signedIn" className="settings-block settings-block--cloud-account">
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
        <GoogleCalendarSettings />
        {onDeviceSyncEnabledChange ? (
          <>
            <div data-setting-id="settings.account.syncMacs" className="settings-row account-device-sync-row">
              <div>
                <div className="lbl settings-label-with-badge">
                  {t("settings.account.deviceSync")}
                  <span className="status-badge">Pro</span>
                </div>
                <div className="desc">
                  {t("settings.account.syncDescription")}{" "}
                  <button type="button" className="account-device-sync-help" aria-haspopup="dialog"
                    onClick={() => setSyncSetupMode("info")}>
                    {t("settings.account.syncLearnMore")}
                  </button>
                </div>
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
                  disabled={!deviceSyncEnabled && !deviceSyncCanEnable}
                  onChange={(enabled) => {
                    if (enabled) setSyncSetupMode("enable");
                    else onDeviceSyncEnabledChange(false);
                  }}
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
                    aria-busy={deviceSyncPurging}
                  >
                    <ActionLabel busy={deviceSyncPurging} busyLabel={t("settings.account.deleting")}>{t("settings.account.deleteCloud")}</ActionLabel>
                  </button>
                </div>
              </div>
            ) : isSignedIn ? (
              <div className="settings-row settings-row--stacked-action">
                <div>
                  <div className="lbl">{t("settings.account.cloudCopy")}</div>
                  <div className="desc">{t("settings.account.deleteCloudDescription")}</div>
                </div>
                <div className="ctrl">
                  <button
                    type="button"
                    className="settings-btn danger"
                    onClick={() => void onPurgeDeviceSyncData?.()}
                    disabled={!onPurgeDeviceSyncData || deviceSyncPurging}
                    aria-busy={deviceSyncPurging}
                  >
                    <ActionLabel busy={deviceSyncPurging} busyLabel={t("settings.account.deleting")}>{t("settings.account.deleteCloud")}</ActionLabel>
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
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

      {/* Plan and account controls come first; the account menu and settings
          search land on the invite card wherever it sits. */}
      {loadFriendInvite && isSignedIn && isSupabaseConfigured && (hasAuthenticatedSession ?? isSignedIn) ? (
        <FriendInviteCard
          accountKey={friendInviteAccountKey(trimmedUserEmail, authUserId)}
          loadInvite={loadFriendInvite}
          codeEntry={showPromoCode ? couponEntryFor("invite") : null}
        />
      ) : null}

      <DeviceSyncSetupModal mode={syncSetupMode} canEnable={deviceSyncCanEnable}
        onClose={() => setSyncSetupMode(null)} onEnable={() => {
          if (!deviceSyncCanEnable) return;
          setSyncSetupMode(null);
          onDeviceSyncEnabledChange?.(true);
        }} />

      {canDeleteAccount && onDeleteAccount ? (
        <div className="settings-block settings-block--danger-zone">
          <h3>{t("settings.account.dangerZone")}</h3>
          <div data-setting-id="settings.account.deleteTitle" className="settings-row settings-row--stacked-action">
            <div>
              <div className="lbl">{t("settings.account.deleteTitle")}</div>
              <div className="desc">{t("settings.account.deleteSettingsDescription")}</div>
            </div>
            <div className="ctrl">
              <button type="button" className="settings-btn danger" onClick={onDeleteAccount}>
                {t("settings.account.deleteAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function organizationRoleLabel(role: OrganizationSeatDisplay["role"], t: LocalizationController["t"]): string {
  if (role === "owner") return t("settings.account.organizationRoleOwner");
  if (role === "admin") return t("settings.account.organizationRoleAdmin");
  return t("settings.account.organizationRoleMember");
}

function describeDeviceSyncStatus(status: DeviceSyncStatus | undefined, t: LocalizationController["t"]): string {
  if (!status || !status.enabled) return t("settings.account.syncWaiting");
  const parts: string[] = [];
  // Sequence gaps can come from received rows or already-covered history.
  // They are not upload work after the actual outbox has drained.
  if (status.pendingPushCount > 0 && status.backfill && status.backfill.pushedSeq < status.backfill.totalSeq) {
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
