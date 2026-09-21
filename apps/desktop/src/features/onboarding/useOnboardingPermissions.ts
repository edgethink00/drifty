import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { capturePostHogEvent, toAnalyticsErrorKind } from "../../lib/analytics/posthogClient";
import type { NotificationPermissionState, OnboardingStep } from "./onboardingFlow";

type UseOnboardingPermissionsOptions = {
  readonly accessibilityGrantedFromApp: boolean;
  readonly accessibilityRequired: boolean;
  readonly onCheckAccessibility: () => Promise<boolean>;
  /** Fired once when Accessibility flips to granted mid-onboarding: tracking starts right away. */
  readonly onEarlyTrackingStart: () => void;
  readonly onRequestAccessibility: () => Promise<boolean>;
  readonly setSetupError: Dispatch<SetStateAction<string | null>>;
  readonly step: OnboardingStep;
  readonly trackerStatus: TrackerStatus | null;
};

export function useOnboardingPermissions({
  accessibilityGrantedFromApp,
  accessibilityRequired,
  onCheckAccessibility,
  onEarlyTrackingStart,
  onRequestAccessibility,
  setSetupError,
  step,
  trackerStatus,
}: UseOnboardingPermissionsOptions) {
  const [accessibilityRecheckPending, setAccessibilityRecheckPending] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "unknown" : "unavailable",
  );

  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const onRequestAccessibilityRef = useRef(onRequestAccessibility);
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const trackerUnavailable = trackerStatus?.trackerMode === "unavailable";
  const accessibilityGranted = accessibilityGrantedFromApp || Boolean(trackerStatus?.accessibilityGranted);
  const accessibilityReady = !accessibilityRequired
    || accessibilityGranted
    || (!isDesktopRuntime && trackerUnavailable);
  const notificationsReady = notificationPermission === "granted" || notificationPermission === "unavailable";

  useEffect(() => {
    onCheckAccessibilityRef.current = onCheckAccessibility;
  }, [onCheckAccessibility]);

  useEffect(() => {
    onRequestAccessibilityRef.current = onRequestAccessibility;
  }, [onRequestAccessibility]);

  // Accessibility granted is the moment capture becomes possible; start tracking
  // right away (once) so the first day includes the time spent finishing onboarding.
  const earlyTrackingStartedRef = useRef(false);
  const previousAccessibilityGrantedRef = useRef(accessibilityGranted);
  useEffect(() => {
    const wasGranted = previousAccessibilityGrantedRef.current;
    previousAccessibilityGrantedRef.current = accessibilityGranted;
    if (wasGranted || !accessibilityGranted || earlyTrackingStartedRef.current) return;
    earlyTrackingStartedRef.current = true;
    onEarlyTrackingStart();
  }, [accessibilityGranted, onEarlyTrackingStart]);

  useEffect(() => {
    if (step !== "permissions") {
      setAccessibilityRecheckPending(true);
      return;
    }
    let cancelled = false;
    let checking = false;
    async function checkAccessibilityStatus() {
      if (checking || cancelled) return;
      checking = true;
      setAccessibilityRecheckPending(true);
      try {
        await onCheckAccessibilityRef.current();
      } catch (error) {
        if (error instanceof Error) return;
      } finally {
        if (!cancelled) setAccessibilityRecheckPending(false);
        checking = false;
      }
    }
    void checkAccessibilityStatus();
    if (accessibilityReady) {
      return () => {
        cancelled = true;
      };
    }
    const intervalId = window.setInterval(() => {
      void checkAccessibilityStatus();
    }, 2000);
    function handleFocus() {
      void checkAccessibilityStatus();
    }
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [accessibilityReady, step]);

  async function handleRequestAccessibilityClick() {
    setSetupError(null);
    try {
      const granted = await onRequestAccessibilityRef.current();
      capturePostHogEvent("permission_action", {
        permission: "accessibility",
        action: "request",
        result: granted ? "success" : "skipped",
        accessibility_granted: granted,
      });
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to request Accessibility access.");
      capturePostHogEvent("permission_action", {
        permission: "accessibility",
        action: "request",
        result: "error",
        accessibility_granted: false,
        error_kind: toAnalyticsErrorKind(error),
      });
    }
  }

  async function handleNotificationPermissionClick() {
    setSetupError(null);
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setNotificationPermission("unavailable");
      capturePostHogEvent("permission_action", {
        permission: "notifications",
        action: "request",
        result: "unavailable",
        accessibility_granted: accessibilityGranted,
        notifications_granted: false,
      });
      return;
    }
    setNotificationPermission("checking");
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      const alreadyGranted = await isPermissionGranted();
      if (alreadyGranted) {
        setNotificationPermission("granted");
        capturePostHogEvent("permission_action", {
          permission: "notifications",
          action: "request",
          result: "success",
          accessibility_granted: accessibilityGranted,
          notifications_granted: true,
        });
        return;
      }
      const permission = await requestPermission();
      if (permission === "granted") {
        setNotificationPermission("granted");
        capturePostHogEvent("permission_action", {
          permission: "notifications",
          action: "request",
          result: "success",
          accessibility_granted: accessibilityGranted,
          notifications_granted: true,
        });
      } else {
        setNotificationPermission("denied");
        capturePostHogEvent("permission_action", {
          permission: "notifications",
          action: "request",
          result: "cancelled",
          accessibility_granted: accessibilityGranted,
          notifications_granted: false,
        });
      }
    } catch (error) {
      setNotificationPermission("unavailable");
      setSetupError(error instanceof Error ? error.message : "Notification permission is unavailable here.");
      capturePostHogEvent("permission_action", {
        permission: "notifications",
        action: "request",
        result: "error",
        accessibility_granted: accessibilityGranted,
        notifications_granted: false,
        error_kind: toAnalyticsErrorKind(error),
      });
    }
  }

  return {
    accessibilityGranted,
    accessibilityRequired,
    accessibilityReady,
    accessibilityRecheckPending,
    handleNotificationPermissionClick,
    handleRequestAccessibilityClick,
    notificationPermission,
    notificationsReady,
  };
}
