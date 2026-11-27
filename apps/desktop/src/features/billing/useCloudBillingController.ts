import { recordProFunnelStep } from "../../lib/analytics/proFunnel";
import { createProductAnalyticsDeliveryGuard } from "../../lib/analytics/productAnalyticsPreference";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthState } from "../auth/AuthContext";
import { revokeCloudDevice, type CloudDeviceRecord } from "../cloud-devices/cloudDeviceService";
import {
  createBillingPortalSession,
  createIndividualCheckout,
  fetchBillingEntitlement,
  startCloudTrial,
  fetchIndividualPricingQuote,
  redeemTrialCoupon,
  type BillingEntitlement,
  type BillingInterval,
  type CheckoutFailureCode,
  type CouponRedemption,
  type CouponRedemptionFailureCode,
} from "./billingService";
import type { IndividualPricingQuote } from "./individualPricing";
import {
  claimCloudTrialStartedNotice,
  type CloudTrialStartedNoticeModel,
} from "./CloudTrialStartedNotice";
import { claimProPurchase, markProCheckoutOpened } from "./proPurchase";
import { toErrorMessage } from "../../lib/formatting";
import { capturePostHogDailyEvent, capturePostHogEvent, recordPostHogAccountPlan, toAnalyticsErrorKind, toDailyDedupKey, type PostHogEventPropertiesByName } from "../../lib/analytics/posthogClient";
import { toPostHogPersonPlan } from "../../lib/analytics/accountProfile";
import { canStartIndividualCheckout } from "./billingEligibility";
import { useNativeTrialStatus } from "./useNativeTrialStatus";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { AnalyticsErrorKind } from "../../lib/analytics/eventHelpers";

type UseCloudBillingControllerInput = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly shouldCheckBillingEntitlement: boolean;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
};

type UseCloudBillingControllerResult = {
  /** Errors from an explicit checkout/portal action; shown locally, never used as global Cloud health. */
  readonly billingActionError: string | null;
  readonly billingActionErrorCode: CheckoutFailureCode | null;
  readonly billingCheckoutAwaitingConfirmation: boolean;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly billingPortalLoading: boolean;
  readonly individualPricingQuote: IndividualPricingQuote | null;
  readonly individualPricingQuoteLoading: boolean;
  readonly couponRedemption: CouponRedemption | null;
  readonly couponRedemptionErrorCode: CouponRedemptionFailureCode | null;
  readonly couponRedemptionLoading: boolean;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices: readonly CloudDeviceRecord[];
  readonly cloudTrialStarting: boolean;
  readonly cloudTrialError: string | null;
  readonly activateCloudTrial: () => Promise<BillingEntitlement>;
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly dismissCloudTrialStartedNotice: () => void;
  /** True once after a Pro checkout opened from the app turns into an active subscription. */
  readonly proPurchaseConfirmed: boolean;
  readonly acknowledgeProPurchase: () => void;
  readonly handleManageCloudBilling: () => Promise<void>;
  readonly handleRedeemTrialCoupon: (code: string) => Promise<void>;
  readonly handleRevokeCloudDevice: (deviceId: string) => Promise<void>;
  /** Creates the Polar checkout for an interval the user explicitly picked. */
  readonly startCloudCheckout: (billingInterval: BillingInterval) => Promise<void>;
  readonly refreshBillingEntitlement: () => Promise<BillingEntitlement | null>;
};

export const CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS = 1_500;
export const CLOUD_ENTITLEMENT_BACKGROUND_RETRY_MS = 30_000;
const CLOUD_ENTITLEMENT_MAX_BACKGROUND_RETRY_MS = 5 * 60_000;

/**
 * An entitlement check runs on auth resolution, on every return from the billing
 * browser and on deep links, so a repeated "still active" says nothing new.
 * Checkout, portal and coupon actions stay per-occurrence: those are real
 * decisions a person made, and each one matters on its own.
 */
function captureEntitlementCheckOncePerDay(
  properties: PostHogEventPropertiesByName["billing_action"],
): void {
  capturePostHogDailyEvent("billing_action", toDailyDedupKey(properties), properties);
}

function cloudEntitlementRetryDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS));
}

async function fetchBillingEntitlementWithConfirmation(
  shouldContinue: () => boolean,
): Promise<Awaited<ReturnType<typeof fetchBillingEntitlement>>> {
  const firstResult = await fetchBillingEntitlement();
  if (firstResult.success || !shouldContinue()) return firstResult;
  await cloudEntitlementRetryDelay();
  if (!shouldContinue()) return firstResult;
  return fetchBillingEntitlement();
}

/**
 * What the person reads when the server refuses to open checkout, and the
 * analytics kind it is filed under. The server sends the same refusals as codes
 * so every supported language gets its own sentence.
 */
const CHECKOUT_FAILURE_COPY: Readonly<Record<CheckoutFailureCode, { readonly message: TranslationKey; readonly errorKind: AnalyticsErrorKind }>> = {
  checkout_maintenance: { message: "billing.checkout.maintenance", errorKind: "unavailable" },
  pricing_revision_mismatch: { message: "billing.checkout.updateRequired", errorKind: "validation" },
  pricing_quote_mismatch: { message: "billing.checkout.priceChanged", errorKind: "validation" },
  checkout_in_progress: { message: "billing.checkout.inProgress", errorKind: "unavailable" },
  checkout_payment_pending: { message: "billing.checkout.paymentPending", errorKind: "unavailable" },
  checkout_session_closed: { message: "billing.checkout.sessionClosed", errorKind: "unavailable" },
  checkout_interval_conflict: { message: "billing.checkout.intervalConflict", errorKind: "unavailable" },
  already_subscribed: { message: "billing.checkout.alreadySubscribed", errorKind: "validation" },
};

export function useCloudBillingController({
  hasRequiredAccountAuth,
  isSupabaseConfigured,
  shouldCheckBillingEntitlement,
  user,
  onAuthRequired,
}: UseCloudBillingControllerInput): UseCloudBillingControllerResult {
  const { t } = useLocalization();
  const [billingEntitlement, setBillingEntitlement] = useState<BillingEntitlement | null>(null);
  // The account a stored entitlement belongs to, so a previous account's trial never reaches the menu.
  const [billingEntitlementAccountId, setBillingEntitlementAccountId] = useState<string | null>(null);
  const [billingEntitlementLoading, setBillingEntitlementLoading] = useState(false);
  const [billingEntitlementError, setBillingEntitlementError] = useState<string | null>(null);
  const [billingActionError, setBillingActionError] = useState<string | null>(null);
  const [billingActionErrorCode, setBillingActionErrorCode] = useState<CheckoutFailureCode | null>(null);
  const [billingCheckoutLoadingInterval, setBillingCheckoutLoadingInterval] = useState<BillingInterval | null>(null);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const [individualPricingQuote, setIndividualPricingQuote] = useState<IndividualPricingQuote | null>(null);
  const [individualPricingQuoteLoading, setIndividualPricingQuoteLoading] = useState(false);
  const [couponRedemption, setCouponRedemption] = useState<CouponRedemption | null>(null);
  const [couponRedemptionErrorCode, setCouponRedemptionErrorCode] = useState<CouponRedemptionFailureCode | null>(null);
  const [couponRedemptionLoading, setCouponRedemptionLoading] = useState(false);
  const [cloudDeviceActionError, setCloudDeviceActionError] = useState<string | null>(null);
  const [cloudDeviceRevokingId, setCloudDeviceRevokingId] = useState<string | null>(null);
  const [cloudTrialStartedNotice, setCloudTrialStartedNotice] = useState<CloudTrialStartedNoticeModel | null>(null);
  const [proPurchaseConfirmed, setProPurchaseConfirmed] = useState(false);
  const [cloudCheckoutAwaitingBrowser, setCloudCheckoutAwaitingBrowser] = useState(false);
  const [billingPortalAwaitingBrowser, setBillingPortalAwaitingBrowser] = useState(false);
  const [cloudTrialStarting, setCloudTrialStarting] = useState(false);
  const [cloudTrialError, setCloudTrialError] = useState<string | null>(null);
  const cloudTrialRequestRef = useRef<Promise<BillingEntitlement> | null>(null);
  const billingEntitlementRequestRef = useRef(0);
  const individualPricingQuoteRequestRef = useRef(0);
  const cloudCheckoutPendingRef = useRef(false);
  const cloudCheckoutConfirmationInFlightRef = useRef(false);
  const couponRedemptionRequestRef = useRef(0);
  const billingActionGenerationRef = useRef(0);
  const billingPortalPendingRef = useRef(false);
  const entitlementRetryAttemptRef = useRef(0);

  // Responses from a previous account (or an unmounted controller) must never
  // open a billing URL or clear the current account's request state.
  useEffect(() => {
    billingActionGenerationRef.current += 1;
    billingEntitlementRequestRef.current += 1;
    entitlementRetryAttemptRef.current = 0;
    setBillingEntitlement(null);
    cloudTrialRequestRef.current = null;
    setCloudTrialStarting(false);
    setCloudTrialError(null);
    individualPricingQuoteRequestRef.current += 1;
    setIndividualPricingQuote(null);
    setIndividualPricingQuoteLoading(false);
    billingPortalPendingRef.current = false;
    cloudCheckoutPendingRef.current = false;
    cloudCheckoutConfirmationInFlightRef.current = false;
    setBillingPortalLoading(false);
    setBillingPortalAwaitingBrowser(false);
    setBillingCheckoutLoadingInterval(null);
    setCloudCheckoutAwaitingBrowser(false);
    setBillingActionError(null);
    setBillingActionErrorCode(null);
    return () => {
      billingActionGenerationRef.current += 1;
      billingEntitlementRequestRef.current += 1;
    };
  }, [user?.id, hasRequiredAccountAuth, isSupabaseConfigured, shouldCheckBillingEntitlement]);

  const activateCloudTrial = useCallback((): Promise<BillingEntitlement> => {
    if (cloudTrialRequestRef.current) return cloudTrialRequestRef.current;
    if (!user || !hasRequiredAccountAuth || !isSupabaseConfigured) {
      return Promise.reject(new Error(t("onboarding.block.account")));
    }
    const generation = billingActionGenerationRef.current;
    const current = () => generation === billingActionGenerationRef.current;
    setCloudTrialStarting(true);
    setCloudTrialError(null);
    setBillingEntitlementLoading(false);
    // Invalidate a pre-activation read so it cannot overwrite the granted access.
    billingEntitlementRequestRef.current += 1;
    const request = (async () => {
      try {
        const result = await startCloudTrial(undefined, user.id);
        if (!current()) throw new Error(t("onboarding.block.account"));
        if (!result.success) throw new Error(result.error);
        billingEntitlementRequestRef.current += 1;
        setBillingEntitlement(result.data);
        setBillingEntitlementAccountId(user.id);
        setBillingEntitlementLoading(false);
        setBillingEntitlementError(null);
        if (!result.data.canUseApp) throw new Error(t("billing.trialActivation.failed"));
        return result.data;
      } catch (error) {
        if (current()) setCloudTrialError(toErrorMessage(error));
        throw error;
      } finally {
        if (current()) {
          setCloudTrialStarting(false);
          cloudTrialRequestRef.current = null;
        }
      }
    })();
    cloudTrialRequestRef.current = request;
    return request;
  }, [hasRequiredAccountAuth, isSupabaseConfigured, t, user]);

  const refreshIndividualPricingQuote = useCallback(async (): Promise<IndividualPricingQuote | null> => {
    if (!shouldCheckBillingEntitlement || !user || !hasRequiredAccountAuth
      || !canStartIndividualCheckout(billingEntitlement)) {
      individualPricingQuoteRequestRef.current += 1;
      setIndividualPricingQuote(null);
      setIndividualPricingQuoteLoading(false);
      return null;
    }

    const requestId = ++individualPricingQuoteRequestRef.current;
    setIndividualPricingQuoteLoading(true);
    const result = await fetchIndividualPricingQuote();
    if (requestId !== individualPricingQuoteRequestRef.current) return null;
    setIndividualPricingQuoteLoading(false);
    if (!result.success) {
      // A quote failure safely falls back to the visible standard USD price.
      // Checkout receives no assignment id and therefore cannot charge a
      // regional amount the app did not show.
      setIndividualPricingQuote(null);
      return null;
    }
    setIndividualPricingQuote(result.data);
    return result.data;
  }, [
    billingEntitlement?.lockedReason,
    billingEntitlement?.status,
    hasRequiredAccountAuth,
    shouldCheckBillingEntitlement,
    user,
  ]);

  const refreshBillingEntitlement = useCallback(async (): Promise<BillingEntitlement | null> => {
    if (!shouldCheckBillingEntitlement) {
      setBillingEntitlement(null);
      setBillingEntitlementLoading(false);
      setBillingEntitlementError(null);
      setBillingActionError(null);
      setBillingActionErrorCode(null);
      setCloudDeviceActionError(null);
      return null;
    }

    const requestId = ++billingEntitlementRequestRef.current;
    setBillingEntitlementLoading(true);
    setBillingEntitlementError(null);
    setCloudDeviceActionError(null);
    let result: Awaited<ReturnType<typeof fetchBillingEntitlement>>;
    try {
      result = await fetchBillingEntitlementWithConfirmation(
        () => requestId === billingEntitlementRequestRef.current,
      );
    } catch (error) {
      if (requestId !== billingEntitlementRequestRef.current) return null;
      const message = toErrorMessage(error);
      setBillingEntitlementError(message);
      setBillingEntitlementLoading(false);
      captureEntitlementCheckOncePerDay({
        action: "entitlement_check",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return null;
    }
    if (requestId !== billingEntitlementRequestRef.current) return null;
    if (result.success) {
      setBillingEntitlement(result.data);
      setBillingEntitlementAccountId(user?.id ?? null);
      setBillingEntitlementLoading(false);
      if (user?.id) recordPostHogAccountPlan(user.id, toPostHogPersonPlan(result.data));
      captureEntitlementCheckOncePerDay({
        action: "entitlement_check",
        result: "success",
        entitlement_status: result.data.status,
        ...(result.data.lockedReason ? { locked_reason: result.data.lockedReason } : {}),
      });
      return result.data;
    }

    setBillingEntitlementError(result.error);
    setBillingEntitlementLoading(false);
    captureEntitlementCheckOncePerDay({
      action: "entitlement_check",
      result: "error",
      error_kind: toAnalyticsErrorKind(result.error),
    });
    return null;
  }, [shouldCheckBillingEntitlement, user?.id]);

  /** Opens billing management for an existing or recoverable subscription. */
  const handleManageCloudBilling = useCallback(async () => {
    if (!isSupabaseConfigured) {
      onAuthRequired();
      return;
    }

    if (!user || !hasRequiredAccountAuth) {
      onAuthRequired();
      return;
    }

    setBillingActionError(null);
    setBillingActionErrorCode(null);
    // `payment_required` reaches the portal too: the subscription exists and only
    // its payment is blocked, so recovery belongs in the portal, not a checkout.
    const canOpenBillingPortal = billingEntitlement?.status === "active"
      || billingEntitlement?.lockedReason === "device_limit_reached"
      || billingEntitlement?.lockedReason === "payment_required";
    if (!canOpenBillingPortal) {
      void refreshBillingEntitlement();
      return;
    }

    if (billingPortalPendingRef.current || cloudCheckoutPendingRef.current) return;
    billingPortalPendingRef.current = true;
    const generation = billingActionGenerationRef.current;
    const isCurrentRequest = () => generation === billingActionGenerationRef.current;
    setBillingPortalLoading(true);
    try {
      const portalResult = await createBillingPortalSession();
      if (!isCurrentRequest()) return;
      if (!portalResult.success) {
        setBillingActionError(portalResult.error);
        setBillingActionErrorCode(null);
        capturePostHogEvent("billing_action", {
          action: "portal_created",
          result: "error",
          entitlement_status: billingEntitlement?.status ?? "unknown",
          ...(billingEntitlement?.lockedReason ? { locked_reason: billingEntitlement.lockedReason } : {}),
          error_kind: toAnalyticsErrorKind(portalResult.error),
        });
        return;
      }

      capturePostHogEvent("billing_action", {
        action: "portal_created",
        result: "success",
        entitlement_status: billingEntitlement?.status ?? "unknown",
        ...(billingEntitlement?.lockedReason ? { locked_reason: billingEntitlement.lockedReason } : {}),
      });
      await openExternalUrl(portalResult.data.url, isCurrentRequest);
      if (!isCurrentRequest()) return;
      setBillingPortalAwaitingBrowser(true);
      capturePostHogEvent("billing_action", {
        action: "portal_opened",
        result: "success",
        entitlement_status: billingEntitlement?.status ?? "unknown",
        ...(billingEntitlement?.lockedReason ? { locked_reason: billingEntitlement.lockedReason } : {}),
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      setBillingActionError(toErrorMessage(error));
      setBillingActionErrorCode(null);
      capturePostHogEvent("billing_action", {
        action: "portal_opened",
        result: "error",
        entitlement_status: billingEntitlement?.status ?? "unknown",
        ...(billingEntitlement?.lockedReason ? { locked_reason: billingEntitlement.lockedReason } : {}),
        error_kind: toAnalyticsErrorKind(error),
      });
    } finally {
      if (isCurrentRequest()) {
        billingPortalPendingRef.current = false;
        setBillingPortalLoading(false);
      }
    }
  }, [billingEntitlement?.lockedReason, billingEntitlement?.status, hasRequiredAccountAuth, isSupabaseConfigured, onAuthRequired, refreshBillingEntitlement, user]);

  /** Creates checkout only after the user explicitly selects a visible cadence. */
  const startCloudCheckout = useCallback(async (billingInterval: BillingInterval) => {
    if (!isSupabaseConfigured || !user || !hasRequiredAccountAuth) {
      onAuthRequired();
      return;
    }
    if (cloudCheckoutPendingRef.current || billingPortalPendingRef.current) return;

    // A blocked payment already owns a subscription. Opening checkout here would
    // sell a second one instead of recovering the one Polar already has.
    if (billingEntitlement?.lockedReason === "payment_required") {
      await handleManageCloudBilling();
      return;
    }
    if (!canStartIndividualCheckout(billingEntitlement)) {
      await refreshBillingEntitlement();
      return;
    }

    setBillingActionError(null);
    setBillingActionErrorCode(null);
    cloudCheckoutPendingRef.current = true;
    const generation = billingActionGenerationRef.current;
    const isCurrentRequest = () => generation === billingActionGenerationRef.current;
    const canRecordCheckout = createProductAnalyticsDeliveryGuard();
    let openedCheckout = false;
    setBillingCheckoutLoadingInterval(billingInterval);
    try {
      const checkoutResult = individualPricingQuote
        ? await createIndividualCheckout(billingInterval, individualPricingQuote)
        : await createIndividualCheckout(billingInterval);
      if (!isCurrentRequest()) return;
      if (!checkoutResult.success) {
        const code = checkoutResult.code ?? null;
        setBillingActionError(code ? t(CHECKOUT_FAILURE_COPY[code].message) : checkoutResult.error);
        setBillingActionErrorCode(code);
        capturePostHogEvent("billing_action", {
          action: "checkout_created",
          result: "error",
          billing_interval: billingInterval,
          error_kind: code ? CHECKOUT_FAILURE_COPY[code].errorKind : toAnalyticsErrorKind(checkoutResult.error),
          failure_code: code ?? "uncoded",
        });
        if (code === "pricing_quote_mismatch") void refreshIndividualPricingQuote();
        // A payment still processing, or a plan that is already active, can turn
        // Pro on without another checkout. Read the plan again instead.
        if (code === "checkout_payment_pending" || code === "already_subscribed") void refreshBillingEntitlement();
        return;
      }

      capturePostHogEvent("billing_action", {
        action: "checkout_created",
        result: "success",
        billing_interval: billingInterval,
      });
      const openedNatively = await openExternalUrl(checkoutResult.data.url, isCurrentRequest);
      if (!isCurrentRequest()) return;
      if (openedNatively && user.is_anonymous !== true && canRecordCheckout()) {
        void recordProFunnelStep({ step: "checkout_opened", billing_interval: billingInterval });
      }
      // Payment happens in the browser. Hold duplicate attempts until the app
      // returns and finishes a bounded entitlement confirmation.
      setCloudCheckoutAwaitingBrowser(true);
      openedCheckout = true;
      // Lets the first active entitlement after this checkout be recognized as the purchase.
      markProCheckoutOpened(user.id);
      capturePostHogEvent("billing_action", {
        action: "checkout_opened",
        result: "success",
        billing_interval: billingInterval,
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      setBillingActionError(toErrorMessage(error));
      setBillingActionErrorCode(null);
      capturePostHogEvent("billing_action", {
        action: "checkout_opened",
        result: "error",
        billing_interval: billingInterval,
        error_kind: toAnalyticsErrorKind(error),
      });
    } finally {
      if (isCurrentRequest()) {
        if (!openedCheckout) cloudCheckoutPendingRef.current = false;
        setBillingCheckoutLoadingInterval(null);
      }
    }
  }, [
    billingEntitlement?.lockedReason,
    billingEntitlement?.status,
    handleManageCloudBilling,
    hasRequiredAccountAuth,
    isSupabaseConfigured,
    individualPricingQuote,
    onAuthRequired,
    refreshIndividualPricingQuote,
    refreshBillingEntitlement,
    t,
    user,
  ]);

  const handleRedeemTrialCoupon = useCallback(async (code: string) => {
    const requestId = ++couponRedemptionRequestRef.current;
    setCouponRedemption(null);
    setCouponRedemptionErrorCode(null);
    if (!isSupabaseConfigured || !user || !hasRequiredAccountAuth) {
      onAuthRequired();
      setCouponRedemptionErrorCode("sign_in_required");
      return;
    }

    setCouponRedemptionLoading(true);
    try {
      const result = await redeemTrialCoupon(code);
      if (requestId !== couponRedemptionRequestRef.current) return;
      if (!result.success) {
        setCouponRedemptionErrorCode(result.code);
        capturePostHogEvent("billing_action", {
          action: "coupon_redeemed",
          result: "error",
          error_kind: toAnalyticsErrorKind(result.code),
        });
        return;
      }

      const shouldApplyLocalGrant = couponRedemptionProvidesCurrentAccess(result.data)
        && isCouponEntitlementOverlayEligible(billingEntitlement);
      if (shouldApplyLocalGrant) {
        setBillingEntitlement((current) => applyCouponEntitlementOverlay(current, result.data));
      }
      const refreshedEntitlement = await refreshBillingEntitlement();
      if (requestId !== couponRedemptionRequestRef.current) return;
      const grantConfirmed = entitlementConfirmsCouponGrant(refreshedEntitlement, result.data);
      if (shouldApplyLocalGrant && !grantConfirmed) {
        setBillingEntitlement((current) => applyCouponEntitlementOverlay(current, result.data));
      }
      setCouponRedemption(result.data);
      capturePostHogEvent("billing_action", {
        action: "coupon_redeemed",
        result: "success",
        entitlement_status: shouldApplyLocalGrant && !grantConfirmed
          ? "trialing"
          : refreshedEntitlement?.status
          ?? (shouldApplyLocalGrant ? "trialing" : billingEntitlement?.status ?? "unknown"),
      });
    } catch (error) {
      if (requestId !== couponRedemptionRequestRef.current) return;
      setCouponRedemptionErrorCode("coupon_unavailable");
      capturePostHogEvent("billing_action", {
        action: "coupon_redeemed",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
    } finally {
      if (requestId === couponRedemptionRequestRef.current) setCouponRedemptionLoading(false);
    }
  }, [billingEntitlement?.status, hasRequiredAccountAuth, isSupabaseConfigured, onAuthRequired, refreshBillingEntitlement, user]);

  const dismissCloudTrialStartedNotice = useCallback(() => {
    setCloudTrialStartedNotice(null);
  }, []);

  const acknowledgeProPurchase = useCallback(() => {
    setProPurchaseConfirmed(false);
  }, []);

  const handleRevokeCloudDevice = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    setCloudDeviceActionError(null);
    setCloudDeviceRevokingId(deviceId);
    try {
      const result = await revokeCloudDevice(deviceId);
      if (!result.success) {
        setCloudDeviceActionError(result.error);
        return;
      }
      await refreshBillingEntitlement();
    } catch (error) {
      setCloudDeviceActionError(toErrorMessage(error));
    } finally {
      setCloudDeviceRevokingId(null);
    }
  }, [refreshBillingEntitlement]);

  useEffect(() => {
    let cancelled = false;
    if (!shouldCheckBillingEntitlement) {
      billingEntitlementRequestRef.current += 1;
      setBillingEntitlement(null);
      setBillingEntitlementLoading(false);
      setBillingEntitlementError(null);
      setBillingActionError(null);
      setBillingActionErrorCode(null);
      setCloudDeviceActionError(null);
      return undefined;
    }

    const requestId = ++billingEntitlementRequestRef.current;
    setBillingEntitlementLoading(true);
    setBillingEntitlementError(null);
    setCloudDeviceActionError(null);
    void fetchBillingEntitlementWithConfirmation(
      () => !cancelled && requestId === billingEntitlementRequestRef.current,
    ).then((result) => {
      if (cancelled) return;
      if (requestId !== billingEntitlementRequestRef.current) return;
      if (result.success) {
        setBillingEntitlement(result.data);
        setBillingEntitlementAccountId(user?.id ?? null);
        if (user?.id) recordPostHogAccountPlan(user.id, toPostHogPersonPlan(result.data));
        captureEntitlementCheckOncePerDay({
          action: "entitlement_check",
          result: "success",
          entitlement_status: result.data.status,
          ...(result.data.lockedReason ? { locked_reason: result.data.lockedReason } : {}),
        });
      } else {
        setBillingEntitlement(null);
        setBillingEntitlementError(result.error);
        capturePostHogEvent("billing_action", {
          action: "entitlement_check",
          result: "error",
          error_kind: toAnalyticsErrorKind(result.error),
        });
      }
    }).catch((error) => {
      if (cancelled || requestId !== billingEntitlementRequestRef.current) return;
      setBillingEntitlementError(toErrorMessage(error));
    }).finally(() => {
      if (!cancelled && requestId === billingEntitlementRequestRef.current) setBillingEntitlementLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [shouldCheckBillingEntitlement, user?.id]);

  useEffect(() => {
    if (!shouldCheckBillingEntitlement || !user?.id || billingEntitlementLoading) return;
    if (!billingEntitlementError) {
      entitlementRetryAttemptRef.current = 0;
      return;
    }
    const delay = Math.min(
      CLOUD_ENTITLEMENT_BACKGROUND_RETRY_MS * 2 ** entitlementRetryAttemptRef.current,
      CLOUD_ENTITLEMENT_MAX_BACKGROUND_RETRY_MS,
    );
    const timer = window.setTimeout(() => {
      entitlementRetryAttemptRef.current = Math.min(entitlementRetryAttemptRef.current + 1, 4);
      void refreshBillingEntitlement();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [billingEntitlementError, billingEntitlementLoading, refreshBillingEntitlement, shouldCheckBillingEntitlement, user?.id]);

  useEffect(() => {
    void refreshIndividualPricingQuote();
    return () => { individualPricingQuoteRequestRef.current += 1; };
  }, [refreshIndividualPricingQuote]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setCloudTrialStartedNotice(null);
      return;
    }

    const notice = claimCloudTrialStartedNotice(userId, billingEntitlement);
    if (notice) setCloudTrialStartedNotice(notice);
  }, [billingEntitlement, user?.id]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setProPurchaseConfirmed(false);
      return;
    }
    // Only the entitlement read for this account can confirm its purchase.
    if (billingEntitlementAccountId !== userId) return;
    if (claimProPurchase(userId, billingEntitlement)) setProPurchaseConfirmed(true);
  }, [billingEntitlement, billingEntitlementAccountId, user?.id]);

  useEffect(() => {
    couponRedemptionRequestRef.current += 1;
    setCouponRedemption(null);
    setCouponRedemptionErrorCode(null);
    setCouponRedemptionLoading(false);
  }, [user?.id]);

  const confirmCloudCheckoutAfterBrowser = useCallback(async () => {
    if (cloudCheckoutConfirmationInFlightRef.current) return;
    cloudCheckoutConfirmationInFlightRef.current = true;
    const generation = billingActionGenerationRef.current;
    try {
      // A focus event can beat Polar's webhook. Confirm a successful-but-stale
      // entitlement once more before allowing another checkout attempt.
      const firstEntitlement = await refreshBillingEntitlement();
      if (generation !== billingActionGenerationRef.current) return;
      if (firstEntitlement?.status !== "active") {
        await cloudEntitlementRetryDelay();
        if (generation !== billingActionGenerationRef.current) return;
        await refreshBillingEntitlement();
      }
    } finally {
      if (generation === billingActionGenerationRef.current) {
        cloudCheckoutPendingRef.current = false;
        cloudCheckoutConfirmationInFlightRef.current = false;
        setCloudCheckoutAwaitingBrowser(false);
      }
    }
  }, [refreshBillingEntitlement]);

  useEffect(() => {
    function handleBillingSuccess() {
      if (cloudCheckoutPendingRef.current) {
        void confirmCloudCheckoutAfterBrowser();
        return;
      }
      void refreshBillingEntitlement();
    }

    window.addEventListener("drifty:billing-success", handleBillingSuccess);
    return () => window.removeEventListener("drifty:billing-success", handleBillingSuccess);
  }, [confirmCloudCheckoutAfterBrowser, refreshBillingEntitlement]);

  // Portal changes do not necessarily emit the checkout-success deep link.
  // Refresh once on the next app focus instead of leaving the old plan visible.
  useEffect(() => {
    if (!billingPortalAwaitingBrowser) return undefined;
    function handlePortalReturn() {
      setBillingPortalAwaitingBrowser(false);
      void refreshBillingEntitlement();
    }
    window.addEventListener("focus", handlePortalReturn, { once: true });
    return () => window.removeEventListener("focus", handlePortalReturn);
  }, [billingPortalAwaitingBrowser, refreshBillingEntitlement]);

  // Payment completes in the browser, so run the bounded confirmation when the
  // app regains focus. A canceled or delayed checkout is then safe to retry.
  useEffect(() => {
    if (!cloudCheckoutAwaitingBrowser) return undefined;

    function handleFocus() {
      void confirmCloudCheckoutAfterBrowser();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [cloudCheckoutAwaitingBrowser, confirmCloudCheckoutAfterBrowser]);

  useEffect(() => {
    if (!cloudCheckoutAwaitingBrowser) return;
    if (billingEntitlement?.status !== "active") return;
    cloudCheckoutPendingRef.current = false;
    setCloudCheckoutAwaitingBrowser(false);
  }, [billingEntitlement?.status, cloudCheckoutAwaitingBrowser]);

  const hasConfirmedAccountEntitlement = shouldCheckBillingEntitlement && hasRequiredAccountAuth
    && isSupabaseConfigured && Boolean(user?.id) && billingEntitlementAccountId === user?.id
    && !billingEntitlementLoading && !billingEntitlementError;
  useNativeTrialStatus(billingEntitlement, hasConfirmedAccountEntitlement);

  return {
    billingActionError,
    billingActionErrorCode,
    billingCheckoutAwaitingConfirmation: cloudCheckoutAwaitingBrowser,
    billingCheckoutLoadingInterval,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingPortalLoading,
    individualPricingQuote,
    individualPricingQuoteLoading,
    couponRedemption,
    couponRedemptionErrorCode,
    couponRedemptionLoading,
    cloudDeviceActionError,
    cloudDeviceRevokingId,
    cloudDevices: billingEntitlement?.cloudDevices ?? [],
    cloudTrialStartedNotice,
    cloudTrialStarting,
    cloudTrialError,
    activateCloudTrial,
    dismissCloudTrialStartedNotice,
    proPurchaseConfirmed,
    acknowledgeProPurchase,
    handleManageCloudBilling,
    handleRedeemTrialCoupon,
    handleRevokeCloudDevice,
    refreshBillingEntitlement,
    startCloudCheckout,
  };
}

async function openExternalUrl(url: string, isCurrentRequest: () => boolean): Promise<boolean> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    if (!isCurrentRequest()) return false;
    await openUrl(url);
    return true;
  } catch (error) {
    if (!isCurrentRequest()) return false;
    if (typeof window === "undefined") throw error;
    window.open(url, "_blank", "noopener,noreferrer");
    // noopener may return null even when opened; do not call this a confirmed checkout exposure.
    return false;
  }
}

function applyCouponEntitlementOverlay(
  current: BillingEntitlement | null,
  redemption: CouponRedemption,
): BillingEntitlement {
  if (current && !isCouponEntitlementOverlayEligible(current)) return current;
  return {
    plan: "individual",
    status: "trialing",
    canUseApp: true,
    trialEndsAt: redemption.trialEndsAt,
    currentPeriodEnd: current?.currentPeriodEnd ?? null,
    ...(current?.deviceAccess ? { deviceAccess: current.deviceAccess } : {}),
    ...(current?.cloudDevices ? { cloudDevices: current.cloudDevices } : {}),
  };
}

function couponRedemptionProvidesCurrentAccess(redemption: CouponRedemption): boolean {
  const trialEnd = Date.parse(redemption.trialEndsAt);
  return Number.isFinite(trialEnd) && trialEnd > Date.now();
}

function isCouponEntitlementOverlayEligible(entitlement: BillingEntitlement | null): boolean {
  if (!entitlement) return true;
  if (entitlement.status === "active") return false;
  if (entitlement.lockedReason !== "payment_required" || !entitlement.currentPeriodEnd) return true;
  const currentPeriodEnd = Date.parse(entitlement.currentPeriodEnd);
  return !Number.isFinite(currentPeriodEnd) || currentPeriodEnd <= Date.now();
}

function entitlementConfirmsCouponGrant(
  entitlement: BillingEntitlement | null,
  redemption: CouponRedemption,
): boolean {
  if (entitlement?.status === "active") return true;
  if (entitlement?.status !== "trialing" || !entitlement.trialEndsAt) return false;
  const confirmedEnd = Date.parse(entitlement.trialEndsAt);
  const grantedEnd = Date.parse(redemption.trialEndsAt);
  return Number.isFinite(confirmedEnd) && Number.isFinite(grantedEnd) && confirmedEnd >= grantedEnd;
}
