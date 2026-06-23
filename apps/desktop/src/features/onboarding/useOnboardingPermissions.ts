import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { openSystemSettingsPane, type SystemSettingsPane } from "../../lib/api/systemSettingsClient";
import type { NotificationPermissionState, OnboardingStep } from "./onboardingFlow";

type UseOnboardingPermissionsOptions = {
  readonly accessibilityGrantedFromApp: boolean;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onEnableDriftAlerts: () => void;
  readonly onRefreshTracker: () => Promise<void>;
  readonly onRequestAccessibility: () => Promise<boolean>;
  readonly setSetupError: Dispatch<SetStateAction<string | null>>;
  readonly step: OnboardingStep;
  readonly trackerStatus: TrackerStatus | null;
};

export function useOnboardingPermissions({
  accessibilityGrantedFromApp,
  onCheckAccessibility,
  onEnableDriftAlerts,
  onRefreshTracker,
  onRequestAccessibility,
  setSetupError,
  step,
  trackerStatus,
}: UseOnboardingPermissionsOptions) {
  const [openingSettingsPane, setOpeningSettingsPane] = useState<SystemSettingsPane | null>(null);
  const [accessibilityJustGranted, setAccessibilityJustGranted] = useState(false);
  const [accessibilityRecheckPending, setAccessibilityRecheckPending] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() =>
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "unknown" : "unavailable",
  );

  const onRefreshTrackerRef = useRef(onRefreshTracker);
  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const onRequestAccessibilityRef = useRef(onRequestAccessibility);
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const trackerUnavailable = trackerStatus?.trackerMode === "unavailable";
  const accessibilityGranted = accessibilityGrantedFromApp || Boolean(trackerStatus?.accessibilityGranted);
  const accessibilityReady = accessibilityGranted || (!isDesktopRuntime && trackerUnavailable);
  const previousAccessibilityGrantedRef = useRef(accessibilityGranted);
  const notificationsReady = notificationPermission === "granted" || notificationPermission === "unavailable";

  useEffect(() => {
    onRefreshTrackerRef.current = onRefreshTracker;
  }, [onRefreshTracker]);

  useEffect(() => {
    onCheckAccessibilityRef.current = onCheckAccessibility;
  }, [onCheckAccessibility]);

  useEffect(() => {
    onRequestAccessibilityRef.current = onRequestAccessibility;
  }, [onRequestAccessibility]);

  useEffect(() => {
    if (step !== "accessibility" && step !== "permissions") {
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

  useEffect(() => {
    const wasAccessibilityGranted = previousAccessibilityGrantedRef.current;
    previousAccessibilityGrantedRef.current = accessibilityGranted;
    if (step === "accessibility" && !wasAccessibilityGranted && accessibilityGranted) {
      setAccessibilityJustGranted(true);
    }
  }, [accessibilityGranted, step]);

  useEffect(() => {
    if (step !== "accessibility") setAccessibilityJustGranted(false);
  }, [step]);

  async function handleRefreshTrackerClick() {
    setSetupError(null);
    try {
      await onRefreshTrackerRef.current();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to refresh tracker status.");
    }
  }

  async function handleRequestAccessibilityClick() {
    setSetupError(null);
    setOpeningSettingsPane("accessibility");
    try {
      await onRequestAccessibilityRef.current();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to request Accessibility access.");
    } finally {
      setOpeningSettingsPane(null);
    }
  }

  async function handleOpenSettingsPane(pane: SystemSettingsPane) {
    setSetupError(null);
    setOpeningSettingsPane(pane);
    try {
      const opened = await openSystemSettingsPane(pane);
      if (!opened) {
        setSetupError("System Settings can only be opened from the macOS desktop app.");
        return;
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Unable to open System Settings.");
    } finally {
      setOpeningSettingsPane(null);
    }
  }

  async function handleNotificationPermissionClick() {
    setSetupError(null);
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setNotificationPermission("unavailable");
      return;
    }
    setNotificationPermission("checking");
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      const alreadyGranted = await isPermissionGranted();
      if (alreadyGranted) {
        onEnableDriftAlerts();
        setNotificationPermission("granted");
        return;
      }
      const permission = await requestPermission();
      if (permission === "granted") {
        onEnableDriftAlerts();
        setNotificationPermission("granted");
      } else {
        setNotificationPermission("denied");
      }
    } catch (error) {
      setNotificationPermission("unavailable");
      setSetupError(error instanceof Error ? error.message : "Notification permission is unavailable here.");
    }
  }

  return {
    accessibilityGranted,
    accessibilityJustGranted,
    accessibilityReady,
    accessibilityRecheckPending,
    handleNotificationPermissionClick,
    handleOpenSettingsPane,
    handleRefreshTrackerClick,
    handleRequestAccessibilityClick,
    notificationPermission,
    notificationsReady,
    openingSettingsPane,
  };
}
