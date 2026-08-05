import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthState } from "../auth/AuthContext";
import { revokeCloudDevice, type CloudDeviceRecord } from "../cloud-devices/cloudDeviceService";
import {
  createBillingPortalSession,
  createIndividualCheckout,
  fetchBillingEntitlement,
  type BillingEntitlement,
  type BillingInterval,
} from "./billingService";
import {
  claimCloudTrialStartedNotice,
  type CloudTrialStartedNoticeModel,
} from "./CloudTrialStartedNotice";
import { toErrorMessage } from "../../lib/formatting";
import { capturePostHogEvent, toAnalyticsErrorKind } from "../../lib/analytics/posthogClient";

type UseCloudBillingControllerInput = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly shouldCheckBillingEntitlement: boolean;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
  readonly onOpenAiSetup: () => void;
};

type UseCloudBillingControllerResult = {
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly billingPortalLoading: boolean;
  readonly cloudDeviceActionError: string | null;
  readonly cloudDeviceRevokingId: string | null;
  readonly cloudDevices: readonly CloudDeviceRecord[];
  readonly cloudTrialStartedNotice: CloudTrialStartedNoticeModel | null;
  readonly dismissCloudTrialStartedNotice: () => void;
  readonly handleManageCloudBilling: () => Promise<void>;
  readonly handleRevokeCloudDevice: (deviceId: string) => Promise<void>;
  readonly handleStartDriftyCloudSetup: (billingInterval?: BillingInterval) => Promise<void>;
  readonly openCloudTrialStartedNoticeAiSetup: () => void;
  readonly refreshBillingEntitlement: () => Promise<BillingEntitlement | null>;
};

export function useCloudBillingController({
  hasRequiredAccountAuth,
  isSupabaseConfigured,
  shouldCheckBillingEntitlement,
  user,
  onAuthRequired,
  onOpenAiSetup,
}: UseCloudBillingControllerInput): UseCloudBillingControllerResult {
  const [billingEntitlement, setBillingEntitlement] = useState<BillingEntitlement | null>(null);
  const [billingEntitlementLoading, setBillingEntitlementLoading] = useState(false);
  const [billingEntitlementError, setBillingEntitlementError] = useState<string | null>(null);
  const [billingCheckoutLoadingInterval, setBillingCheckoutLoadingInterval] = useState<BillingInterval | null>(null);
  const [billingPortalLoading, setBillingPortalLoading] = useState(false);
  const [cloudDeviceActionError, setCloudDeviceActionError] = useState<string | null>(null);
  const [cloudDeviceRevokingId, setCloudDeviceRevokingId] = useState<string | null>(null);
  const [cloudTrialStartedNotice, setCloudTrialStartedNotice] = useState<CloudTrialStartedNoticeModel | null>(null);
  const billingEntitlementRequestRef = useRef(0);

  const refreshBillingEntitlement = useCallback(async (): Promise<BillingEntitlement | null> => {
    if (!shouldCheckBillingEntitlement) {
      setBillingEntitlement(null);
      setBillingEntitlementLoading(false);
      setBillingEntitlementError(null);
      setCloudDeviceActionError(null);
      return null;
    }

    const requestId = ++billingEntitlementRequestRef.current;
    setBillingEntitlementLoading(true);
    setBillingEntitlementError(null);
    setCloudDeviceActionError(null);
    const result = await fetchBillingEntitlement();
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

  const handleStartDriftyCloudSetup = useCallback(async (billingInterval: BillingInterval = "monthly") => {
    if (!isSupabaseConfigured) {
      onAuthRequired();
      return;
    }

    if (!user || !hasRequiredAccountAuth) {
      onAuthRequired();
      return;
    }

    if (billingEntitlement?.status === "active") {
      void refreshBillingEntitlement();
      return;
    }

    setBillingEntitlementError(null);
    setBillingCheckoutLoadingInterval(billingInterval);
    try {
      const checkoutResult = await createIndividualCheckout(billingInterval);
      if (!checkoutResult.success) {
        setBillingEntitlementError(checkoutResult.error);
        capturePostHogEvent("billing_action", {
          action: "checkout_created",
          result: "error",
          billing_interval: billingInterval,
          error_kind: toAnalyticsErrorKind(checkoutResult.error),
        });
        return;
      }

      capturePostHogEvent("billing_action", {
        action: "checkout_created",
        result: "success",
        billing_interval: billingInterval,
      });
      await openExternalUrl(checkoutResult.data.url);
      capturePostHogEvent("billing_action", {
        action: "checkout_opened",
        result: "success",
        billing_interval: billingInterval,
      });
    } catch (error) {
      setBillingEntitlementError(toErrorMessage(error));
      capturePostHogEvent("billing_action", {
        action: "checkout_opened",
        result: "error",
        billing_interval: billingInterval,
        error_kind: toAnalyticsErrorKind(error),
      });
    } finally {
      setBillingCheckoutLoadingInterval(null);
    }
  }, [billingEntitlement?.status, hasRequiredAccountAuth, isSupabaseConfigured, onAuthRequired, refreshBillingEntitlement, user]);

  const handleManageCloudBilling = useCallback(async () => {
    if (!isSupabaseConfigured) {
      onAuthRequired();
      return;
    }

    if (!user || !hasRequiredAccountAuth) {
      onAuthRequired();
      return;
    }

    const canOpenBillingPortal = billingEntitlement?.status === "active"
      || billingEntitlement?.lockedReason === "device_limit_reached";
    if (!canOpenBillingPortal) {
      void refreshBillingEntitlement();
      return;
    }

    setBillingEntitlementError(null);
    setBillingPortalLoading(true);
    try {
      const portalResult = await createBillingPortalSession();
      if (!portalResult.success) {
        setBillingEntitlementError(portalResult.error);
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
      setBillingEntitlementError(toErrorMessage(error));
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
      setCloudDeviceActionError(null);
      return undefined;
    }

    const requestId = ++billingEntitlementRequestRef.current;
    setBillingEntitlementLoading(true);
    setBillingEntitlementError(null);
    setCloudDeviceActionError(null);
    void fetchBillingEntitlement().then((result) => {
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
    function handleBillingSuccess() {
      void refreshBillingEntitlement();
    }

    window.addEventListener("drifty:billing-success", handleBillingSuccess);
    return () => window.removeEventListener("drifty:billing-success", handleBillingSuccess);
  }, [refreshBillingEntitlement]);

  return {
    billingCheckoutLoadingInterval,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingPortalLoading,
    cloudDeviceActionError,
    cloudDeviceRevokingId,
    cloudDevices: billingEntitlement?.cloudDevices ?? [],
    cloudTrialStartedNotice,
    dismissCloudTrialStartedNotice,
    handleManageCloudBilling,
    handleRevokeCloudDevice,
    handleStartDriftyCloudSetup,
    openCloudTrialStartedNoticeAiSetup,
    refreshBillingEntitlement,
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
