import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthState } from "../auth/AuthContext";
import { revokeCloudDevice, type CloudDeviceRecord } from "../cloud-devices/cloudDeviceService";
import {
  createBillingPortalSession,
  createIndividualCheckout,
  fetchBillingEntitlement,
  redeemTrialCoupon,
  type BillingEntitlement,
  type BillingInterval,
  type CheckoutFailureCode,
  type CouponRedemption,
  type CouponRedemptionFailureCode,
} from "./billingService";
import {
  claimCloudTrialStartedNotice,
  type CloudTrialStartedNoticeModel,
} from "./CloudTrialStartedNotice";
import { toErrorMessage } from "../../lib/formatting";
import { capturePostHogEvent, toAnalyticsErrorKind } from "../../lib/analytics/posthogClient";
import { canStartIndividualCheckout } from "./billingEligibility";
import { useLocalization } from "../localization/LocalizationContext";

type UseCloudBillingControllerInput = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly shouldCheckBillingEntitlement: boolean;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
  readonly onOpenAiSetup: () => void;
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
  readonly couponRedemption: CouponRedemption | null;
  readonly couponRedemptionErrorCode: CouponRedemptionFailureCode | null;
  readonly couponRedemptionLoading: boolean;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices: readonly CloudDeviceRecord[];
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly dismissCloudTrialStartedNotice: () => void;
  readonly handleManageCloudBilling: () => Promise<void>;
  readonly handleRedeemTrialCoupon: (code: string) => Promise<void>;
  readonly handleRevokeCloudDevice: (deviceId: string) => Promise<void>;
  /** Creates the Polar checkout for an interval the user explicitly picked. */
  readonly startCloudCheckout: (billingInterval: BillingInterval) => Promise<void>;
  readonly openCloudTrialStartedNoticeAiSetup: () => void;
  readonly refreshBillingEntitlement: () => Promise<BillingEntitlement | null>;
};

export const CLOUD_ENTITLEMENT_CONFIRMATION_RETRY_MS = 1_500;

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

export function useCloudBillingController({
  hasRequiredAccountAuth,
  isSupabaseConfigured,
  shouldCheckBillingEntitlement,
  user,
  onAuthRequired,
  onOpenAiSetup,
}: UseCloudBillingControllerInput): UseCloudBillingControllerResult {
  const { t } = useLocalization();
  const [billingEntitlement, setBillingEntitlement] = useState<BillingEntitlement | null>(null);
  const [billingEntitlementLoading, setBillingEntitlementLoading] = useState(false);
  const [billingEntitlementError, setBillingEntitlementError] = useState<string | null>(null);
  const [billingActionError, setBillingActionError] = useState<string | null>(null);
  const [billingActionErrorCode, setBillingActionErrorCode] = useState<CheckoutFailureCode | null>(null);
  const [billingCheckoutLoadingInterval, setBillingCheckoutLoadingInterval] = useState<BillingInterval | null>(null);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const [couponRedemption, setCouponRedemption] = useState<CouponRedemption | null>(null);
  const [couponRedemptionErrorCode, setCouponRedemptionErrorCode] = useState<CouponRedemptionFailureCode | null>(null);
  const [couponRedemptionLoading, setCouponRedemptionLoading] = useState(false);
  const [cloudDeviceActionError, setCloudDeviceActionError] = useState<string | null>(null);
  const [cloudDeviceRevokingId, setCloudDeviceRevokingId] = useState<string | null>(null);
  const [cloudTrialStartedNotice, setCloudTrialStartedNotice] = useState<CloudTrialStartedNoticeModel | null>(null);
  const [cloudCheckoutAwaitingBrowser, setCloudCheckoutAwaitingBrowser] = useState(false);
  const billingEntitlementRequestRef = useRef(0);
  const cloudCheckoutPendingRef = useRef(false);
  const cloudCheckoutConfirmationInFlightRef = useRef(false);
  const couponRedemptionRequestRef = useRef(0);

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
      capturePostHogEvent("billing_action", {
        action: "entitlement_check",
        result: "error",
        error_kind: toAnalyticsErrorKind(error),
      });
      return null;
    }
    if (requestId !== billingEntitlementRequestRef.current) return null;
    if (result.success) {
      setBillingEntitlement(result.data);
      setBillingEntitlementLoading(false);
      capturePostHogEvent("billing_action", {
        action: "entitlement_check",
        result: "success",
        entitlement_status: result.data.status,
        ...(result.data.lockedReason ? { locked_reason: result.data.lockedReason } : {}),
      });
      return result.data;
    }

    setBillingEntitlementError(result.error);
    setBillingEntitlementLoading(false);
    capturePostHogEvent("billing_action", {
      action: "entitlement_check",
      result: "error",
      error_kind: toAnalyticsErrorKind(result.error),
    });
    return null;
  }, [shouldCheckBillingEntitlement]);

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

    setBillingPortalLoading(true);
    try {
      const portalResult = await createBillingPortalSession();
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
      await openExternalUrl(portalResult.data.url);
      capturePostHogEvent("billing_action", {
        action: "portal_opened",
        result: "success",
        entitlement_status: billingEntitlement?.status ?? "unknown",
        ...(billingEntitlement?.lockedReason ? { locked_reason: billingEntitlement.lockedReason } : {}),
      });
    } catch (error) {
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
      setBillingPortalLoading(false);
    }
  }, [billingEntitlement?.lockedReason, billingEntitlement?.status, hasRequiredAccountAuth, isSupabaseConfigured, onAuthRequired, refreshBillingEntitlement, user]);

  /** Creates checkout only after the user explicitly selects a visible cadence. */
  const startCloudCheckout = useCallback(async (billingInterval: BillingInterval) => {
    if (!isSupabaseConfigured || !user || !hasRequiredAccountAuth) {
      onAuthRequired();
      return;
    }
    if (cloudCheckoutPendingRef.current) return;

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
    let openedCheckout = false;
    setBillingCheckoutLoadingInterval(billingInterval);
    try {
      const checkoutResult = await createIndividualCheckout(billingInterval);
      if (!checkoutResult.success) {
        const checkoutError = checkoutResult.code === "checkout_maintenance"
          ? t("billing.checkout.maintenance")
          : checkoutResult.code === "pricing_revision_mismatch"
            ? t("billing.checkout.updateRequired")
            : checkoutResult.error;
        setBillingActionError(checkoutError);
        setBillingActionErrorCode(checkoutResult.code ?? null);
        capturePostHogEvent("billing_action", {
          action: "checkout_created",
          result: "error",
          billing_interval: billingInterval,
          error_kind: checkoutResult.code === "checkout_maintenance"
            ? "unavailable"
            : checkoutResult.code === "pricing_revision_mismatch"
              ? "validation"
              : toAnalyticsErrorKind(checkoutResult.error),
        });
        return;
      }

      capturePostHogEvent("billing_action", {
        action: "checkout_created",
        result: "success",
        billing_interval: billingInterval,
      });
      await openExternalUrl(checkoutResult.data.url);
      // Payment happens in the browser. Hold duplicate attempts until the app
      // returns and finishes a bounded entitlement confirmation.
      setCloudCheckoutAwaitingBrowser(true);
      openedCheckout = true;
      capturePostHogEvent("billing_action", {
        action: "checkout_opened",
        result: "success",
        billing_interval: billingInterval,
      });
    } catch (error) {
      setBillingActionError(toErrorMessage(error));
      setBillingActionErrorCode(null);
      capturePostHogEvent("billing_action", {
        action: "checkout_opened",
        result: "error",
        billing_interval: billingInterval,
        error_kind: toAnalyticsErrorKind(error),
      });
    } finally {
      if (!openedCheckout) cloudCheckoutPendingRef.current = false;
      setBillingCheckoutLoadingInterval(null);
    }
  }, [
    billingEntitlement?.lockedReason,
    billingEntitlement?.status,
    handleManageCloudBilling,
    hasRequiredAccountAuth,
    isSupabaseConfigured,
    onAuthRequired,
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

  const openCloudTrialStartedNoticeAiSetup = useCallback(() => {
    onOpenAiSetup();
    setCloudTrialStartedNotice(null);
  }, [onOpenAiSetup]);

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
        capturePostHogEvent("billing_action", {
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
    }).finally(() => {
      if (!cancelled && requestId === billingEntitlementRequestRef.current) setBillingEntitlementLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [shouldCheckBillingEntitlement, user?.id]);

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
    couponRedemptionRequestRef.current += 1;
    setCouponRedemption(null);
    setCouponRedemptionErrorCode(null);
    setCouponRedemptionLoading(false);
  }, [user?.id]);

  useEffect(() => {
    cloudCheckoutPendingRef.current = false;
    cloudCheckoutConfirmationInFlightRef.current = false;
    setCloudCheckoutAwaitingBrowser(false);
  }, [shouldCheckBillingEntitlement, user?.id]);

  const confirmCloudCheckoutAfterBrowser = useCallback(async () => {
    if (cloudCheckoutConfirmationInFlightRef.current) return;
    cloudCheckoutConfirmationInFlightRef.current = true;
    try {
      // A focus event can beat Polar's webhook. Confirm a successful-but-stale
      // entitlement once more before allowing another checkout attempt.
      const firstEntitlement = await refreshBillingEntitlement();
      if (firstEntitlement?.status !== "active") {
        await cloudEntitlementRetryDelay();
        await refreshBillingEntitlement();
      }
    } finally {
      cloudCheckoutPendingRef.current = false;
      cloudCheckoutConfirmationInFlightRef.current = false;
      setCloudCheckoutAwaitingBrowser(false);
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

  return {
    billingActionError,
    billingActionErrorCode,
    billingCheckoutAwaitingConfirmation: cloudCheckoutAwaitingBrowser,
    billingCheckoutLoadingInterval,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingPortalLoading,
    couponRedemption,
    couponRedemptionErrorCode,
    couponRedemptionLoading,
    cloudDeviceActionError,
    cloudDeviceRevokingId,
    cloudDevices: billingEntitlement?.cloudDevices ?? [],
    cloudTrialStartedNotice,
    dismissCloudTrialStartedNotice,
    handleManageCloudBilling,
    handleRedeemTrialCoupon,
    handleRevokeCloudDevice,
    openCloudTrialStartedNoticeAiSetup,
    refreshBillingEntitlement,
    startCloudCheckout,
  };
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  } catch (error) {
    if (typeof window === "undefined") throw error;
    window.open(url, "_blank", "noopener,noreferrer");
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
