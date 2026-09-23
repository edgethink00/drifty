import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { useSafariHistoryPermission } from "../onboarding/useSafariHistoryPermission";
import { accessibilityClient } from "../../lib/api/accessibilityClient";
import {
  openFullDiskAccessSettingsPane,
  openSystemSettingsPane,
} from "../../lib/api/systemSettingsClient";
import "./PermissionsSettingsSection.css";

type NotificationPermissionState =
  | "checking"
  | "granted"
  | "denied"
  | "notDetermined"
  | "unavailable"
  | "error";

type PermissionsSettingsSectionProps = {
  readonly accessibilityGranted: boolean;
  readonly accessibilityRequired: boolean;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onRequestAccessibility: () => Promise<boolean>;
};

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function PermissionsSettingsSection({
  accessibilityGranted,
  accessibilityRequired,
  onCheckAccessibility,
  onRequestAccessibility,
}: PermissionsSettingsSectionProps) {
  const { t } = useLocalization();
  const desktopRuntime = isDesktopRuntime();
  const safariHistory = useSafariHistoryPermission("permissions");
  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const onRequestAccessibilityRef = useRef(onRequestAccessibility);
  const [accessibilityChecking, setAccessibilityChecking] = useState(desktopRuntime);
  const [accessibilityError, setAccessibilityError] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(
    desktopRuntime ? "checking" : "unavailable",
  );
  const [notificationError, setNotificationError] = useState(false);

  useEffect(() => {
    onCheckAccessibilityRef.current = onCheckAccessibility;
  }, [onCheckAccessibility]);

  useEffect(() => {
    onRequestAccessibilityRef.current = onRequestAccessibility;
  }, [onRequestAccessibility]);

  const refreshAccessibility = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setAccessibilityChecking(false);
      return;
    }
    setAccessibilityChecking(true);
    setAccessibilityError(false);
    try {
      await onCheckAccessibilityRef.current();
    } catch {
      setAccessibilityError(true);
    } finally {
      setAccessibilityChecking(false);
    }
  }, []);

  const refreshNotificationPermission = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setNotificationPermission("unavailable");
      return;
    }
    setNotificationPermission((current) => current === "denied" ? current : "checking");
    setNotificationError(false);
    try {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) {
        setNotificationPermission("granted");
        return;
      }
      const browserPermission = typeof Notification === "undefined" ? "default" : Notification.permission;
      setNotificationPermission((current) => (
        browserPermission === "denied" || current === "denied" ? "denied" : "notDetermined"
      ));
    } catch {
      setNotificationPermission("error");
      setNotificationError(true);
    }
  }, []);

  useEffect(() => {
    void refreshAccessibility();
    void refreshNotificationPermission();
    function handleFocus() {
      void refreshAccessibility();
      void refreshNotificationPermission();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshAccessibility, refreshNotificationPermission]);

  async function handleAccessibilityAction() {
    if (!desktopRuntime) return;
    setAccessibilityError(false);
    setAccessibilityChecking(true);
    try {
      if (accessibilityGranted) {
        await openSystemSettingsPane("accessibility");
      } else {
        await onRequestAccessibilityRef.current();
      }
    } catch {
      setAccessibilityError(true);
    } finally {
      setAccessibilityChecking(false);
    }
  }

  async function handleNotificationAction() {
    if (!desktopRuntime) return;
    setNotificationError(false);
    if (notificationPermission === "error") {
      await refreshNotificationPermission();
      return;
    }
    if (notificationPermission === "granted" || notificationPermission === "denied") {
      try {
        await openSystemSettingsPane("notifications");
      } catch {
        setNotificationError(true);
      }
      return;
    }
    setNotificationPermission("checking");
    try {
      const { requestPermission } = await import("@tauri-apps/plugin-notification");
      const permission = await requestPermission();
      setNotificationPermission(permission === "granted" ? "granted" : "denied");
    } catch {
      setNotificationPermission("error");
      setNotificationError(true);
    }
  }

  function accessibilityStatus() {
    if (!desktopRuntime) return t("settings.permissions.macAppOnly");
    if (accessibilityChecking) return t("settings.permissions.checking");
    if (accessibilityError) return t("settings.permissions.checkFailedStatus");
    return accessibilityGranted ? t("common.enabled") : t("settings.permissions.notEnabled");
  }

  function notificationStatus() {
    if (notificationPermission === "checking") return t("settings.permissions.checking");
    if (notificationPermission === "granted") return t("common.enabled");
    if (notificationPermission === "denied") return t("settings.permissions.notEnabled");
    if (notificationPermission === "notDetermined") return t("settings.permissions.notEnabled");
    if (notificationPermission === "error") return t("settings.permissions.checkFailedStatus");
    return t("settings.permissions.macAppOnly");
  }

  function accessibilityActionLabel() {
    if (!desktopRuntime) return t("settings.permissions.unavailableAction");
    if (accessibilityChecking) return t("settings.permissions.checking");
    return accessibilityGranted
      ? t(openSettingsLabelKey())
      : t("settings.permissions.allowAccessibility");
  }

  // The button opens the host's own settings app, so name the one it opens.
  function openSettingsLabelKey() {
    return accessibilityClient.detectHostPlatform() === "windows"
      ? "settings.permissions.openSystemSettingsWindows"
      : "settings.permissions.openSystemSettings";
  }

  function notificationActionLabel() {
    if (notificationPermission === "unavailable") return t("settings.permissions.unavailableAction");
    if (notificationPermission === "checking") return t("settings.permissions.checking");
    if (notificationPermission === "granted" || notificationPermission === "denied") {
      return t(openSettingsLabelKey());
    }
    if (notificationPermission === "error") return t("settings.permissions.checkAgain");
    return t("settings.permissions.allowNotifications");
  }

  const accessibilityTone = !desktopRuntime
    ? "unavailable"
    : accessibilityGranted
      ? "success"
      : accessibilityError
        ? "error"
        : "required";
  const notificationTone = notificationPermission === "granted"
    ? "success"
    : notificationPermission === "error"
      ? "error"
      : notificationPermission === "unavailable"
        ? "unavailable"
        : "neutral";

  return (
    <div data-setting-id="settings.permissions.title" className="settings-section settings-section--permissions">
      <div className="settings-block">
        <h3>{t("settings.permissions.title")}</h3>
        <p className="settings-permissions-intro">{t("settings.permissions.intro")}</p>

        {accessibilityRequired ? (
          <div data-setting-id="settings.permissions.accessibility" className="settings-row settings-row--group-start settings-permission-row">
            <div>
              <div className="settings-permission-title-line">
                <div className="lbl">{t("settings.permissions.accessibility")}</div>
                <span className="ui-badge ui-badge--warn settings-permission-requirement">{t("common.required")}</span>
              </div>
              <div className="desc">{t("settings.permissions.accessibilityDescription")}</div>
              {accessibilityError ? (
                <div className="settings-permission-error" role="alert">{t("settings.permissions.checkFailed")}</div>
              ) : null}
            </div>
            <div className="ctrl settings-permission-control">
              <span className="settings-permission-status" data-tone={accessibilityTone} aria-live="polite">
                {accessibilityStatus()}
              </span>
              <button
                type="button"
                className="settings-btn"
                disabled={!desktopRuntime || accessibilityChecking}
                onClick={() => void handleAccessibilityAction()}
              >
                {accessibilityActionLabel()}
              </button>
            </div>
          </div>
        ) : null}

        <div data-setting-id="settings.permissions.notifications" className={`settings-row settings-permission-row${accessibilityRequired ? "" : " settings-row--group-start"}${safariHistory.show ? "" : " settings-row--group-end"}`}>
          <div>
            <div className="settings-permission-title-line">
              <div className="lbl">{t("settings.permissions.notifications")}</div>
              <span className="ui-badge settings-permission-requirement">{t("common.recommended")}</span>
            </div>
            <div className="desc">{t("settings.permissions.notificationsDescription")}</div>
            {notificationError ? (
              <div className="settings-permission-error" role="alert">{t("settings.permissions.checkFailed")}</div>
            ) : null}
          </div>
          <div className="ctrl settings-permission-control">
            <span className="settings-permission-status" data-tone={notificationTone} aria-live="polite">
              {notificationStatus()}
            </span>
            <button
              type="button"
              className="settings-btn"
              disabled={notificationPermission === "unavailable" || notificationPermission === "checking"}
              onClick={() => void handleNotificationAction()}
            >
              {notificationActionLabel()}
            </button>
          </div>
        </div>

        {safariHistory.show ? (
          <div className="settings-row settings-row--group-end settings-permission-row">
            <div>
              <div className="settings-permission-title-line">
                <div className="lbl">{t("settings.permissions.safariHistory")}</div>
                <span className="ui-badge ui-badge--quiet settings-permission-requirement">{t("common.optional")}</span>
              </div>
              <div className="desc">{t("settings.permissions.safariHistoryDescription")}</div>
            </div>
            <div className="ctrl settings-permission-control">
              <span
                className="settings-permission-status"
                data-tone={safariHistory.readable ? "success" : "neutral"}
                aria-live="polite"
              >
                {safariHistory.readable ? t("common.enabled") : t("settings.permissions.notEnabled")}
              </span>
              <button
                type="button"
                className="settings-btn"
                disabled={safariHistory.opening}
                onClick={() => {
                  if (safariHistory.readable) {
                    void openFullDiskAccessSettingsPane();
                  } else {
                    safariHistory.onEnable();
                  }
                }}
              >
                {safariHistory.opening
                  ? t("settings.permissions.opening")
                  : safariHistory.readable
                    ? t("settings.permissions.openSystemSettings")
                    : t("settings.permissions.allowSafariHistory")}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
