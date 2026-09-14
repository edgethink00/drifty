import { useRef, useState } from "react";
import { canStartCloudTrial } from "../billing/billingEligibility";
import { AccountPlanModal } from "./AccountPlanModal";
import { CloudDeviceManagementPanel } from "../cloud-devices/CloudDeviceManagementPanel";
import { Toggle } from "../../components/Toggle";
import { IndividualPlanCards, type BillingPlanId } from "../billing/IndividualPlanCards";
import { formatOrganizationSeatAccessCopy } from "../billing/billingAccessCopy";
import {
  dissolveOwnOrganization,
  releaseOwnOrganizationSeat,
  type OrganizationDissolveResult,
  type OrganizationSeatReleaseResult,
} from "../billing/organizationSeatService";
import { resolveOrganizationSeatDisplay, resolvePlanCardState, type OrganizationSeatDisplay } from "../billing/planCardState";
import { TrialCouponRedemption } from "./TrialCouponRedemption";
import type {
  BillingEntitlement,
  BillingInterval,
  CheckoutFailureCode,
  CouponRedemption,
  CouponRedemptionFailureCode,
} from "../billing/billingService";
import type { IndividualPricingQuote } from "../billing/individualPricing";
import type { DeviceSyncStatus } from "../device-sync/deviceSyncTypes";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizeSettingsError } from "../localization/settingsMessageTranslations";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import "./AccountSettingsSection.css";

export const ORGANIZATION_SEAT_MANAGEMENT_URL = "https://drifty.so/account/organization";

export type AccountSettingsSectionProps = {
  readonly billingCheckoutAwaitingConfirmation?: boolean;
  readonly billingActionErrorCode?: CheckoutFailureCode | null;
  readonly onCheckForUpdates?: () => void;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlement?: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLockedReason: BillingEntitlement["lockedReason"] | null;
  readonly billingEntitlementStatus: BillingEntitlement["status"] | null;
  readonly billingPlansDisabled: boolean;
  readonly billingPortalLoading: boolean;
  readonly individualPricingQuote?: IndividualPricingQuote | null;
  readonly couponRedemption: CouponRedemption | null;
  readonly couponRedemptionErrorCode: CouponRedemptionFailureCode | null;
  readonly couponRedemptionLoading: boolean;
  readonly cloudDeviceAccess: BillingEntitlement["deviceAccess"] | null;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices: BillingEntitlement["cloudDevices"];
  readonly cloudStatusRefreshing: boolean;
  readonly currentBillingPlan: BillingPlanId | null;
  readonly hasAuthenticatedSession?: boolean;
  readonly hasSignedInAccount?: boolean;
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
  readonly onDeleteAccount?: () => void;
  readonly onEditPublicProfile?: () => void;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onOpenAiSetup?: () => void;
  readonly onOpenLeaderboard?: () => void;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRedeemTrialCoupon: (code: string) => void | Promise<void>;
  readonly onReleaseOrganizationSeat?: (seatId: string) => Promise<OrganizationSeatReleaseResult>;
  readonly onDissolveOrganization?: () => Promise<OrganizationDissolveResult>;
  readonly onRevokeCloudDevice: (deviceId: string) => void | Promise<void>;
  readonly onSignIn: () => void;
  readonly onStartCloudSetup: (billingInterval: BillingInterval) => void | Promise<void>;
};

export function AccountSettingsSection({
  billingCheckoutAwaitingConfirmation = false,
  billingActionErrorCode,
  onCheckForUpdates,
  billingCheckoutLoadingInterval,
  billingEntitlement = null,
  billingEntitlementError,
  billingEntitlementLockedReason,
  billingEntitlementStatus,
  billingPlansDisabled,
  billingPortalLoading,
  individualPricingQuote = null,
  couponRedemption,
  couponRedemptionErrorCode,
  couponRedemptionLoading,
  cloudDeviceAccess,
  cloudDeviceActionError,
  cloudDeviceRevokingId,
  cloudDevices = [],
  cloudStatusRefreshing,
  currentBillingPlan,
  hasAuthenticatedSession,
  hasSignedInAccount,
  isSupabaseConfigured,
  publicProfileDisplayName,
  publicProfileStatus,
  userEmail,
  deviceSyncEnabled = false,
  deviceSyncGateActive = false,
  deviceSyncStatus,
  deviceSyncPurging = false,
  onDeviceSyncEnabledChange,
  onDeviceSyncNow,
  onPurgeDeviceSyncData,
  onDeleteAccount,
  onEditPublicProfile,
  onManageCloudBilling,
  onOpenAiSetup,
  onOpenLeaderboard,
  onRefreshCloudStatus,
  onRedeemTrialCoupon,
  onReleaseOrganizationSeat = releaseOwnOrganizationSeat,
  onDissolveOrganization = dissolveOwnOrganization,
  onRevokeCloudDevice,
  onSignIn,
  onStartCloudSetup,
}: AccountSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [planModalOpen, setPlanModalOpen] = useState(false);
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
    if (!(hasAuthenticatedSession ?? isSignedIn) || !isSignedIn || !isSupabaseConfigured) setPlanModalOpen(false);
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
  const trialAvailable = canStartCloudTrial(billingEntitlement);
  const planCardsCurrentPlan: BillingPlanId | null = isTrialing ? null : billingEntitlementStatus === "locked" && !isDeviceLimitLocked && !isPaymentRequiredLocked ? "free" : currentBillingPlan;
  // Keep billing recovery directly accessible even when comparison is closed.
  const canManageCurrentPlan = isCurrentCloudPlan || isDeviceLimitLocked || isPaymentRequiredLocked;
  const trimmedUserEmail = userEmail?.trim() ?? "";
  const isSignedIn = hasSignedInAccount ?? trimmedUserEmail.length > 0;
  const planStatusUnknown = isSignedIn && isSupabaseConfigured && billingEntitlementStatus === null;
  const plansDisabled = billingPlansDisabled || planActionBusy || planStatusUnknown;
  const actionError = localActionError ?? billingEntitlementError;
  const billingProgress = billingCheckoutAwaitingConfirmation
    ? t("settings.account.checkoutPending")
    : planActionBusy ? t("settings.account.billingOpening") : null;
  const canDeleteAccount = hasAuthenticatedSession ?? isSignedIn;
  const accountEmail = trimmedUserEmail || (isSignedIn
    ? t("settings.account.signedInWithoutEmail")
    : t("settings.account.notSignedIn"));

  const planCards = (
    <div className="settings-row settings-row--cloud-pricing">
      <IndividualPlanCards
        currentPlan={planCardsCurrentPlan}
        disabled={plansDisabled}
        showBillingInterval={!canManageCurrentPlan}
        freePlanDisabled={planActionBusy}
        loadingInterval={billingCheckoutLoadingInterval}
        manageCurrentPlanLabel={isPaymentRequiredLocked ? t("settings.account.fixBilling") : undefined}
        manageCurrentPlanLoading={billingPortalLoading}
        mode="display"
        planState={planState}
        pricingQuote={individualPricingQuote}
        onManageCurrentPlan={canManageCurrentPlan ? () => void runBillingAction(onManageCloudBilling) : undefined}
        onSelectFreePlan={onOpenAiSetup ? () => {
          setPlanModalOpen(false);
          onOpenAiSetup();
        } : undefined}
        onSelectPlan={(interval) => {
          if (!(hasAuthenticatedSession ?? isSignedIn) || !isSignedIn || !isSupabaseConfigured) setPlanModalOpen(false);
          void runBillingAction(() => onStartCloudSetup(interval));
        }}
      />
    </div>
  );

  return (
    <div className="settings-section settings-section--account">
      {/* Account opens on current access; comparison stays in its own dialog. */}
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
            <div className="lbl">{trialAvailable ? t("billing.trialActivation.available") : organizationSeatCopy ? organizationSeatCopy.title : planStatusUnknown ? t(cloudStatusRefreshing ? "settings.account.planChecking" : "settings.account.planUnavailable") : isTrialing || canManageCurrentPlan ? t("billing.plan.pro") : t("billing.plan.free")}</div>
            <div className="desc">{trialAvailable ? t("billing.trialActivation.availableBody") : organizationSeat && organizationSeatCopy
              ? [organizationSeatCopy.summary, t("settings.account.organizationRole", { role: organizationRoleLabel(organizationSeat.role, t) })].join(" ")
              : planStatusUnknown ? t("settings.account.planUnknownDescription") : isTrialing
                ? t("billing.plan.trialBadge")
                : planState === "trial_expired"
                  ? t("settings.account.trialEndedSummary")
                  : canManageCurrentPlan
                    ? t("settings.account.proSummary")
                    : t("settings.account.freeSummary")}</div>
          </div>
          <div className="ctrl account-plan-summary__actions">
            {trialAvailable && onOpenAiSetup ? <button type="button" className="settings-btn primary" onClick={onOpenAiSetup}>{t("sidebar.cta.ai.action")}</button> : null}
            <button type="button" className={trialAvailable ? "settings-btn" : "settings-btn primary"} aria-haspopup="dialog"
              onClick={(event) => { event.currentTarget.focus(); setPlanModalOpen(true); }}>
              {t("settings.account.changePlan")}
            </button>
            {planStatusUnknown ? (
              <button type="button" className="settings-btn" disabled={cloudStatusRefreshing}
                onClick={() => void onRefreshCloudStatus()}>{t("settings.account.refreshPlan")}</button>
            ) : null}
            {canManageCurrentPlan && !organizationSeat ? (
              <button type="button" className="settings-btn" disabled={planActionBusy || billingPlansDisabled}
                onClick={() => void runBillingAction(onManageCloudBilling)}>
                {billingPortalLoading ? t("billing.plan.openingBilling") : isPaymentRequiredLocked ? t("settings.account.fixBilling") : t("billing.plan.manageBilling")}
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

      <AccountPlanModal open={planModalOpen} busy={planActionBusy} onClose={() => setPlanModalOpen(false)}>
        {planStatusUnknown ? <div className="account-plan-progress" role="status">
          <p>{t("settings.account.planUnknownDescription")}</p>
          <button type="button" className="modal-btn" disabled={cloudStatusRefreshing}
            onClick={() => void onRefreshCloudStatus()}>{t("settings.account.refreshPlan")}</button>
        </div> : null}
        {canManageCurrentPlan ? <p className="account-plan-progress">{t("settings.account.existingPlanComparison")}</p> : null}
        {billingProgress ? <p className="account-plan-progress" role="status">{billingProgress}</p> : null}
        {planCards}
        {actionError || billingActionErrorCode === "pricing_revision_mismatch" ? (
          <div className="account-plan-modal__error" role="alert">
            <p>{actionError ? localizeSettingsError(actionError, effectiveLanguage, t) : t("billing.checkout.updateRequired")}</p>
            {billingActionErrorCode === "pricing_revision_mismatch" && onCheckForUpdates ? (
              <button type="button" className="modal-btn" onClick={() => { setPlanModalOpen(false); onCheckForUpdates(); }}>{t("billing.checkout.checkForUpdates")}</button>
            ) : null}
          </div>
        ) : null}
      </AccountPlanModal>

      <TrialCouponRedemption
        disabled={billingPlansDisabled || !isSupabaseConfigured || !isSignedIn}
        errorCode={couponRedemptionErrorCode}
        isSignedIn={isSignedIn}
        loading={couponRedemptionLoading}
        redemption={couponRedemption}
        onRedeem={onRedeemTrialCoupon}
      />

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

      <div data-setting-id="settings.account.publicProfile" className="settings-block">
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
          <div data-setting-id="settings.account.syncMacs" className="settings-row">
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
                >
                  {deviceSyncPurging ? t("settings.account.deleting") : t("settings.account.deleteCloud")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

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
