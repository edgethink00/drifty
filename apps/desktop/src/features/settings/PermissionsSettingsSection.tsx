import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import { useSafariHistoryPermission } from "../onboarding/useSafariHistoryPermission";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import {
  openFullDiskAccessSettingsPane,
  openSystemSettingsPane,
} from "../../lib/api/systemSettingsClient";
import "./PermissionsSettingsSection.css";

type PermissionsSettingsSectionProps = {
  readonly accessibilityGranted: boolean;
  readonly accessibilityRequired: boolean;
  /** The app's host platform, corrected by the native permission response. */
  readonly hostPlatform?: HostPlatform;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onRequestAccessibility: () => Promise<boolean>;
};

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function PermissionsSettingsSection({
  accessibilityGranted,
  accessibilityRequired,
  hostPlatform = "macos",
  onCheckAccessibility,
  onRequestAccessibility,
}: PermissionsSettingsSectionProps) {
  const { t } = useLocalization();
  const desktopRuntime = isDesktopRuntime();
  const safariHistory = useSafariHistoryPermission("permissions", { context: "settings" });
  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const onRequestAccessibilityRef = useRef(onRequestAccessibility);
  const [accessibilityChecking, setAccessibilityChecking] = useState(desktopRuntime);
  const [accessibilityError, setAccessibilityError] = useState(false);
  const [notificationSettingsError, setNotificationSettingsError] = useState(false);
  const windowsHost = hostPlatform === "windows";

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

  useEffect(() => {
    void refreshAccessibility();
    function handleFocus() {
      void refreshAccessibility();
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshAccessibility]);

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

  // macOS and Windows deliver Drifty notifications without a permission prompt,
  // and the desktop notification plugin (2.3.x) answers "granted" without asking
  // the OS. A status here could not reflect a user who turned notifications off,
  // so the row explains the default and opens the OS notification settings.
  async function openNotificationSettings() {
    if (!desktopRuntime) return;
    setNotificationSettingsError(false);
    try {
      await openSystemSettingsPane("notifications");
    } catch {
      setNotificationSettingsError(true);
    }
  }

  function accessibilityStatus() {
    if (!desktopRuntime) return t("settings.permissions.macAppOnly");
    if (accessibilityChecking) return t("settings.permissions.checking");
    if (accessibilityError) return t("settings.permissions.checkFailedStatus");
    return accessibilityGranted ? t("common.enabled") : t("settings.permissions.notEnabled");
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
    return windowsHost
      ? "settings.permissions.openSystemSettingsWindows"
      : "settings.permissions.openSystemSettings";
  }

  const accessibilityTone = !desktopRuntime
    ? "unavailable"
    : accessibilityGranted
      ? "success"
      : accessibilityError
        ? "error"
        : "required";

  // Rendered as the last block of Settings > General, not as its own page:
  // two or three status rows (one on Windows) did not justify a sidebar tab.
  return (
    <div data-setting-id="settings.permissions.title" className="settings-block settings-block--permissions">
      <h3>{t("settings.permissions.title")}</h3>

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
          <div className="desc">{t(windowsHost
            ? "settings.permissions.notificationsDescriptionWindows"
            : "settings.permissions.notificationsDescription")}</div>
          {notificationSettingsError ? (
            <div className="settings-permission-error" role="alert">{t("settings.permissions.openFailed")}</div>
          ) : null}
        </div>
        {/* No status column on desktop: there is no OS permission to report.
            The button stays in the action column so it lines up with the rows above. */}
        <div className={`ctrl settings-permission-control${desktopRuntime ? " settings-permission-control--action-only" : ""}`}>
          {desktopRuntime ? null : (
            <span className="settings-permission-status" data-tone="unavailable">
              {t("settings.permissions.macAppOnly")}
            </span>
          )}
          <button
            type="button"
            className="settings-btn"
            disabled={!desktopRuntime}
            onClick={() => void openNotificationSettings()}
          >
            {desktopRuntime ? t(openSettingsLabelKey()) : t("settings.permissions.unavailableAction")}
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
  );
}
