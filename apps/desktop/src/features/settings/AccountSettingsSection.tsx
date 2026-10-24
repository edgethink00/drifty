import { lazy, Suspense, useRef, useState } from "react";
import { canOfferPromoCode, canStartCloudTrial } from "../billing/billingEligibility";
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

// Chat preview only: loaded on demand so Settings does not pull in Chat otherwise.
const LazyChatCreditsRow = lazy(async () => ({ default: (await import("../chat/ChatCreditsRow")).ChatCreditsRow }));
import { friendInviteAccountKey } from "./friendInviteStore";
import type {
  BillingEntitlement,
  BillingInterval,
  CouponRedemption,
  CouponRedemptionFailureCode,
  FriendInviteResult,
} from "../billing/billingService";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import { SettingsRowDescription } from "./SettingsRowDescription";
import "./AccountSettingsSection.css";
import { ActionLabel } from "../../components/ActionLabel";

export const ORGANIZATION_SEAT_MANAGEMENT_URL = "https://drifty.so/account/organization";
export const ORGANIZATION_SEAT_MANAGEMENT_URL_KO = "https://drifty.so/ko/account/organization/";

/** The team page has an English and a Korean copy; open the one matching the app. */
export function organizationSeatManagementUrl(language: string): string {
  return language === "ko" ? ORGANIZATION_SEAT_MANAGEMENT_URL_KO : ORGANIZATION_SEAT_MANAGEMENT_URL;
}

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
  readonly cloudStatusRefreshing: boolean;
  readonly hasAuthenticatedSession?: boolean;
  readonly hasSignedInAccount?: boolean;
  readonly isSupabaseConfigured: boolean;
  /** Reads the account's friend invite. Without it the gift row is not offered. */
  readonly loadFriendInvite?: () => Promise<FriendInviteResult>;
  readonly userEmail: string | null;
  readonly authUserId?: string | null;
  readonly onDeleteAccount?: () => void;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onOpenAiSetup?: () => void;
  readonly onRefreshCloudStatus: () => void | Promise<unknown>;
  readonly onRedeemTrialCoupon: (code: string) => void | Promise<void>;
  readonly onReleaseOrganizationSeat?: (seatId: string) => Promise<OrganizationSeatReleaseResult>;
  readonly onDissolveOrganization?: () => Promise<OrganizationDissolveResult>;
  readonly onSignIn: () => void;
  /** Opens the one Pro decision sheet (or sign-in first); see ProDecisionSheet. */
  readonly onUpgradeToPro?: () => void;
  /** Shows the Drifty Cloud chat credits row while the Chat preview is on. */
  readonly chatCreditsVisible?: boolean;
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
  cloudStatusRefreshing,
  hasAuthenticatedSession,
  hasSignedInAccount,
  isSupabaseConfigured,
  loadFriendInvite,
  userEmail,
  authUserId,
  onDeleteAccount,
  onManageCloudBilling,
  onOpenAiSetup,
  onRefreshCloudStatus,
  onRedeemTrialCoupon,
  onReleaseOrganizationSeat = releaseOwnOrganizationSeat,
  onDissolveOrganization = dissolveOwnOrganization,
  onSignIn,
  onUpgradeToPro,
  chatCreditsVisible = false,
}: AccountSettingsSectionProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [couponSurface, setCouponSurface] = useState<"plan" | "invite">("plan");
  const [localActionPending, setLocalActionPending] = useState(false);
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  // The billing error is shared by every billing surface (the Pro sheet, the
  // sidebar card). This row reports it only after its own Manage billing press.
  const [portalRequested, setPortalRequested] = useState(false);
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
      await openUrl(organizationSeatManagementUrl(effectiveLanguage));
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
  // An action's progress shows inside its button. Its outcome, and the wait for
  // a checkout finishing in the browser, take the account line of the same row
  // instead of inserting a line that pushes the rest of Account down.
  // The line says what did not happen in the app language; a backend's own
  // wording stays in the title and for screen readers, so the line stays short.
  const planRowError: DescribedActionError | null = localActionError
    ? { message: localActionError, detail: null }
    : portalRequested && billingActionError
      ? describeActionError(billingActionError, t("settings.account.billingActionFailed"))
      : organizationOpenError
        ? { message: t("settings.account.organizationOpenFailed"), detail: null }
        : null;
  const planRowMessage: { readonly text: string; readonly detail: string | null; readonly tone: "status" | "error" } | null = planRowError
    ? { text: planRowError.message, detail: planRowError.detail, tone: "error" }
    : billingCheckoutAwaitingConfirmation
      ? { text: t("settings.account.checkoutPending"), detail: null, tone: "status" }
      : null;
  const seatReleaseNoticeText = seatReleaseNotice === null ? null : t(seatReleaseNotice === "pending"
    ? "settings.account.releaseSeatPending"
    : seatReleaseNotice === "refused"
      ? "settings.account.releaseSeatRefused"
      : "settings.account.releaseSeatFailed");
  const dissolveNoticeText = dissolveNotice === null ? null : t(dissolveNotice === "pending"
    ? "settings.account.dissolvePending"
    : dissolveNotice === "refused"
      ? "settings.account.dissolveRefused"
      : "settings.account.dissolveFailed");
  const canDeleteAccount = hasAuthenticatedSession ?? isSignedIn;
  const canDissolveOrganization = organizationSeat?.role === "owner";
  const accountEmail = trimmedUserEmail || (isSignedIn
    ? t("settings.account.signedInWithoutEmail")
    : t("settings.account.notSignedIn"));
  // The plan row also says who is signed in, so there is no separate account
  // block. A status line (trial, seat, ended trial) stays above the account
  // line; the generic Pro/Free sentence only fills the line while nobody is
  // signed in, since the account line replaces it afterwards.
  const planStatusText = trialAvailable ? t("billing.trialActivation.availableBody") : organizationSeat && organizationSeatCopy
    ? [organizationSeatCopy.summary, t("settings.account.organizationRole", { role: organizationRoleLabel(organizationSeat.role, t) })].join(" ")
    : planStatusUnknown ? "" : isTrialing
      ? t("billing.plan.trialBadge")
      : planState === "trial_expired"
        ? t("settings.account.trialEndedSummary")
        : isSignedIn ? "" : canManageCurrentPlan
          ? t("settings.account.proSummary")
          : t("settings.account.freeSummary");
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
        {isDeviceLimitLocked || isPaymentRequiredLocked ? (
          <div className="account-plan-notice" role="status">
            {isDeviceLimitLocked ? <p>{t("settings.account.deviceLimit")}</p> : null}
            {isPaymentRequiredLocked ? <p>{t("settings.account.paymentRequired")}</p> : null}
          </div>
        ) : null}
        <div data-setting-id="settings.account.signedIn" className="settings-row account-plan-summary">
          <div>
            <div className="lbl">{trialAvailable ? t("billing.trialActivation.available") : organizationSeatCopy ? organizationSeatCopy.title : planStatusUnknown ? t("settings.ai.status.checking") : isTrialing || canManageCurrentPlan ? t("billing.plan.pro") : t("billing.plan.free")}</div>
            {planStatusText ? <div className="desc">{planStatusText}</div> : null}
            {/* One live line whose text changes, so a screen reader hears a
                message taking the account's place and the account coming back. */}
            <div
              className={`desc account-plan-summary__account${planRowMessage ? " account-plan-summary__message" : ""}${planRowMessage?.tone === "error" ? " account-plan-notice__error" : ""}`}
              role="status"
              title={planRowMessage ? [planRowMessage.text, planRowMessage.detail].filter(Boolean).join("\n") : undefined}
            >
              {planRowMessage ? (
                <>
                  {planRowMessage.text}
                  {planRowMessage.detail ? <span className="sr-only"> {planRowMessage.detail}</span> : null}
                </>
              ) : accountEmail}
            </div>
          </div>
          <div className="ctrl account-plan-summary__actions">
            {!isSignedIn ? (
              <button type="button" className="settings-btn" onClick={onSignIn}>
                {t("settings.account.signIn")}
              </button>
            ) : null}
            {trialAvailable && onOpenAiSetup ? <button type="button" className="settings-btn primary" onClick={onOpenAiSetup}>{t("sidebar.cta.ai.action")}</button> : null}
            {!trialAvailable && !organizationSeat && !canManageCurrentPlan && onUpgradeToPro ? (
              <button type="button" className="settings-btn primary" aria-haspopup="dialog" disabled={upgradeDisabled}
                aria-busy={billingCheckoutLoadingInterval !== null || undefined} onClick={() => { setPortalRequested(false); onUpgradeToPro(); }}>
                <ActionLabel busy={billingCheckoutLoadingInterval !== null} busyLabel={t("billing.plan.opening")}>{t("billing.plan.proCta")}</ActionLabel>
              </button>
            ) : null}
            {canManageCurrentPlan && !organizationSeat ? (
              <button type="button" className="settings-btn primary" disabled={planActionBusy || billingPlansDisabled} aria-busy={billingPortalLoading}
                onClick={() => { setPortalRequested(true); void runBillingAction(onManageCloudBilling); }}>
                <ActionLabel busy={billingPortalLoading} busyLabel={t("billing.plan.opening")}>{isPaymentRequiredLocked ? t("settings.account.fixBilling") : t("billing.plan.manageBilling")}</ActionLabel>
              </button>
            ) : null}
            {organizationSeat?.canManageSeats ? (
              <button type="button" className="settings-btn" disabled={organizationOpening}
                aria-busy={organizationOpening}
                onClick={() => void openOrganizationSeatManagement()}>
                <ActionLabel busy={organizationOpening} busyLabel={t("billing.plan.opening")}>{t("settings.account.manageSeats")}</ActionLabel>
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
              <SettingsRowDescription
                description={t(seatReleaseConfirming
                  ? "settings.account.releaseSeatConfirmDescription"
                  : "settings.account.releaseSeatDescription")}
                notice={seatReleaseNoticeText}
              />
            </div>
            <div className="ctrl account-plan-summary__actions">
              {seatReleaseConfirming ? (
                <>
                  <button type="button" className="settings-btn danger"
                    disabled={seatReleaseWorking} aria-busy={seatReleaseWorking}
                    onClick={() => void releaseOrganizationSeat(organizationSeat.seatId)}>
                    <ActionLabel busy={seatReleaseWorking} busyLabel={t("settings.account.releaseSeatWorking")}>
                      {t("settings.account.releaseSeatConfirm")}
                    </ActionLabel>
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
        {chatCreditsVisible && isSignedIn ? (
          <Suspense fallback={null}>
            <LazyChatCreditsRow />
          </Suspense>
        ) : null}
        <GoogleCalendarSettings />
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


      {(canDeleteAccount && onDeleteAccount) || canDissolveOrganization ? (
        <div className="settings-block settings-block--danger-zone">
          <h3>{t("settings.account.dangerZone")}</h3>
          {/* Cancelling a team plan ends Pro for every member at once, so it
              sits with account deletion instead of next to seat management. */}
          {canDissolveOrganization && organizationSeat ? (
            <div className="settings-row settings-row--stacked-action account-organization-dissolve">
              <div>
                <div className="lbl">{t("settings.account.dissolveTitle")}</div>
                <SettingsRowDescription
                  description={t(dissolveConfirming
                    ? "settings.account.dissolveConfirmDescription"
                    : "settings.account.dissolveDescription")}
                  notice={dissolveNoticeText}
                />
              </div>
              {dissolveConfirming ? (
                <input
                  className="settings-input account-organization-dissolve__name"
                  type="text"
                  value={dissolveNameInput}
                  disabled={dissolveWorking}
                  onChange={(event) => setDissolveNameInput(event.target.value)}
                  placeholder={t("settings.account.dissolveNamePlaceholder")}
                  aria-label={t("settings.account.dissolveNamePlaceholder")}
                />
              ) : null}
              <div className="ctrl account-plan-summary__actions">
                {dissolveConfirming ? (
                  <>
                    <button type="button" className="settings-btn danger"
                      disabled={dissolveWorking || dissolveNameInput.trim() !== organizationSeat.organizationName.trim()}
                      aria-busy={dissolveWorking}
                      onClick={() => void dissolveOrganization()}>
                      <ActionLabel busy={dissolveWorking} busyLabel={t("settings.account.dissolveWorking")}>
                        {t("settings.account.dissolveConfirm")}
                      </ActionLabel>
                    </button>
                    <button type="button" className="settings-btn" disabled={dissolveWorking}
                      onClick={() => { setDissolveConfirming(false); setDissolveNameInput(""); setDissolveNotice(null); }}>
                      {t("settings.account.dissolveCancel")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="settings-btn danger"
                    onClick={() => { setDissolveConfirming(true); setDissolveNotice(null); }}>
                    {t("settings.account.dissolve")}
                  </button>
                )}
              </div>
            </div>
          ) : null}
          {canDeleteAccount && onDeleteAccount ? (
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
          ) : null}
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
