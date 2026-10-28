import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ActionLabel } from "../../components/ActionLabel";
import { useLocalization } from "../localization/LocalizationContext";
import { useSafariHistoryPermission } from "../onboarding/useSafariHistoryPermission";
import type { HostPlatform } from "../../lib/api/accessibilityClient";
import { useAccessibilityPaneIsDeviceControl } from "../../lib/api/accessibilityPaneName";
import {
  openFullDiskAccessSettingsPane,
  openSystemSettingsPane,
} from "../../lib/api/systemSettingsClient";
import type { TranslationKey } from "../localization/translations";
import { useNativeNotificationAuthorization } from "./useNativeNotificationAuthorization";
import "./PermissionsSettingsSection.css";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { ScreenRecordingPermissionRow } from "./ScreenContextSettings";
import { useScreenRecordingAvailable } from "../screen-context/useScreenRecording";

type PermissionsSettingsSectionProps = {
  readonly accessibilityGranted: boolean;
  readonly accessibilityRequired: boolean;
  /** The app's host platform, corrected by the native permission response. */
  readonly hostPlatform?: HostPlatform;
  readonly onCheckAccessibility: () => Promise<boolean>;
  readonly onRequestAccessibility: () => Promise<boolean>;
  /** Optional screen recording, shown in the desktop app. */
  readonly screenContextClient?: ScreenContextClient;
  readonly showScreenDiagnostics?: boolean;
};

type OsSettingsTarget = "accessibility" | "notifications" | "safariHistory";

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// A permission row keeps one control in its action column: the step the user
// still has to take (a bordered button) or the result (a status). Never both,
// because a button beside "Enabled" asks for an action the row no longer needs.
// This is also how the onboarding permission step reads. Notifications on
// Windows, or in a Drifty process outside an app bundle, is the one row whose
// button is a shortcut rather than a step: it has no status to show, so its
// button is the row's only control.
function PermissionControl({ children }: { readonly children: ReactNode }) {
  return <div className="ctrl settings-permission-control settings-permission-control--single">{children}</div>;
}

function PermissionStatus({ label, tone }: { readonly label: string; readonly tone: "success" | "neutral" | "unavailable" }) {
  return (
    <PermissionControl>
      <span className="settings-permission-status" data-tone={tone} aria-live="polite">{label}</span>
    </PermissionControl>
  );
}

// A granted permission still needs a way into the OS settings app, for example
// to turn access off. That is a quiet text link closing the description, the
// same link style the denied-notification notice uses, so it does not compete
// with the status.
function OsSettingsLink({ label, onOpen }: { readonly label: string; readonly onOpen: () => void }) {
  return (
    <button type="button" className="settings-inline-link settings-permission-link" onClick={onOpen}>
      {label} <span aria-hidden="true">→</span>
    </button>
  );
}

export function PermissionsSettingsSection({
  accessibilityGranted,
  accessibilityRequired,
  hostPlatform = "macos",
  onCheckAccessibility,
  onRequestAccessibility,
  screenContextClient,
  showScreenDiagnostics = false,
}: PermissionsSettingsSectionProps) {
  const { t } = useLocalization();
  // macOS 27 names the page "Device Control and Data Access"; say what System Settings says.
  const deviceControl = useAccessibilityPaneIsDeviceControl();
  const allowAccessibilityKey = deviceControl ? "settings.permissions.allowDeviceControl" : "settings.permissions.allowAccessibility";
  const desktopRuntime = isDesktopRuntime();
  const safariHistory = useSafariHistoryPermission("permissions", { context: "settings" });
  const onCheckAccessibilityRef = useRef(onCheckAccessibility);
  const onRequestAccessibilityRef = useRef(onRequestAccessibility);
  const [accessibilityChecking, setAccessibilityChecking] = useState(desktopRuntime);
  const [accessibilityRequesting, setAccessibilityRequesting] = useState(false);
  const [accessibilityError, setAccessibilityError] = useState(false);
  const [openFailedTarget, setOpenFailedTarget] = useState<OsSettingsTarget | null>(null);
  const windowsHost = hostPlatform === "windows";
  const screenRecordingAvailable = useScreenRecordingAvailable();
  const screenRow = Boolean(screenContextClient?.isDesktop()) && screenRecordingAvailable;
  const { authorization: notificationAuthorization, request: requestNotificationAuthorization } = useNativeNotificationAuthorization();
  /* Only macOS's UNUserNotificationCenter reports a real answer. Windows and a
     Drifty process outside an app bundle report "unavailable" and keep the
     plain shortcut to the OS settings. */
  const notificationStatus = !windowsHost && notificationAuthorization && notificationAuthorization !== "unavailable"
    ? notificationAuthorization
    : null;

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

  async function requestAccessibility() {
    if (!desktopRuntime || accessibilityRequesting) return;
    setAccessibilityError(false);
    setAccessibilityRequesting(true);
    try {
      await onRequestAccessibilityRef.current();
    } catch {
      setAccessibilityError(true);
    } finally {
      setAccessibilityRequesting(false);
    }
  }

  async function openOsSettings(target: OsSettingsTarget) {
    if (!desktopRuntime) return;
    setOpenFailedTarget(null);
    try {
      if (target === "safariHistory") await openFullDiskAccessSettingsPane();
      else await openSystemSettingsPane(target);
    } catch {
      setOpenFailedTarget(target);
    }
  }

  // The link opens the host's own settings app, so name the one it opens.
  const openSettingsLabel = t(windowsHost
    ? "settings.permissions.openSystemSettingsWindows"
    : "settings.permissions.openSystemSettings");

  const openFailedAlert = (target: OsSettingsTarget) => openFailedTarget === target ? (
    <div className="settings-permission-error" role="alert">{t("settings.permissions.openFailed")}</div>
  ) : null;

  function accessibilityControl() {
    if (!desktopRuntime) return <PermissionStatus label={t("settings.permissions.macAppOnly")} tone="unavailable" />;
    if (accessibilityChecking) return <PermissionStatus label={t("settings.permissions.checking")} tone="neutral" />;
    if (accessibilityGranted && !accessibilityError) return <PermissionStatus label={t("common.enabled")} tone="success" />;
    return (
      <PermissionControl>
        <button
          type="button"
          className="settings-btn"
          disabled={accessibilityRequesting}
          aria-busy={accessibilityRequesting || undefined}
          onClick={() => void (accessibilityError ? refreshAccessibility() : requestAccessibility())}
        >
          <ActionLabel
            busy={accessibilityRequesting}
            busyLabel={t("settings.permissions.opening")}
            reserve={[t(accessibilityError ? allowAccessibilityKey : "settings.permissions.checkAgain")]}
          >
            {accessibilityError ? t("settings.permissions.checkAgain") : t(allowAccessibilityKey)}
          </ActionLabel>
        </button>
      </PermissionControl>
    );
  }

  const accessibilitySettled = desktopRuntime && !accessibilityChecking && accessibilityGranted && !accessibilityError;

  function notificationDescriptionKey(): TranslationKey {
    if (notificationStatus === "authorized") return "settings.permissions.notificationsDescriptionAuthorized";
    if (notificationStatus === "denied") return "settings.permissions.notificationsDescriptionDenied";
    if (notificationStatus === "notDetermined") return "settings.permissions.notificationsDescriptionNotDetermined";
    return windowsHost
      ? "settings.permissions.notificationsDescriptionWindows"
      : "settings.permissions.notificationsDescription";
  }

  // Allowed: the status, with the settings link in the description. Off: the
  // step that turns them back on. Not asked: the step that asks. No readable
  // answer: the shortcut alone, as on Windows.
  function notificationControl() {
    if (!desktopRuntime) return <PermissionStatus label={t("settings.permissions.macAppOnly")} tone="unavailable" />;
    if (notificationStatus === "authorized") return <PermissionStatus label={t("common.enabled")} tone="success" />;
    if (notificationStatus === "notDetermined") {
      return (
        <PermissionControl>
          <button type="button" className="settings-btn" onClick={() => void requestNotificationAuthorization()}>
            {t("settings.permissions.allowNotifications")}
          </button>
        </PermissionControl>
      );
    }
    return (
      <PermissionControl>
        <button type="button" className="settings-btn" onClick={() => void openOsSettings("notifications")}>
          {openSettingsLabel}
        </button>
      </PermissionControl>
    );
  }

  // Rendered as the last block of Settings > General, not as its own page:
  // two or three status rows (one on Windows) did not justify a sidebar tab.
  return (
    <div data-setting-id="settings.permissions.title" className="settings-block settings-block--permissions">
      <h3>{t("settings.permissions.title")}</h3>

      {accessibilityRequired ? (
        <div data-setting-id="settings.permissions.accessibility" className="settings-row settings-row--group-start settings-permission-row">
          <div>
            <div className="settings-permission-title-line">
              <div className="lbl">{t(deviceControl ? "settings.permissions.deviceControl" : "settings.permissions.accessibility")}</div>
              <span className="ui-badge ui-badge--warn settings-permission-requirement">{t("common.required")}</span>
            </div>
            <div className="desc">
              {t("settings.permissions.accessibilityDescription")}
              {accessibilitySettled ? (
                <> <OsSettingsLink label={openSettingsLabel} onOpen={() => void openOsSettings("accessibility")} /></>
              ) : null}
            </div>
            {accessibilityError ? (
              <div className="settings-permission-error" role="alert">{t("settings.permissions.checkFailed")}</div>
            ) : null}
            {openFailedAlert("accessibility")}
          </div>
          {accessibilityControl()}
        </div>
      ) : null}

      <div data-setting-id="settings.permissions.notifications" className={`settings-row settings-permission-row${accessibilityRequired ? "" : " settings-row--group-start"}${safariHistory.show || screenRow ? "" : " settings-row--group-end"}`}>
        <div>
          <div className="settings-permission-title-line">
            <div className="lbl">{t("settings.permissions.notifications")}</div>
            <span className="ui-badge settings-permission-requirement">{t("common.recommended")}</span>
          </div>
          <div className="desc">
            {t(notificationDescriptionKey())}
            {notificationStatus === "authorized" ? (
              <> <OsSettingsLink label={openSettingsLabel} onOpen={() => void openOsSettings("notifications")} /></>
            ) : null}
          </div>
          {openFailedAlert("notifications")}
        </div>
        {notificationControl()}
      </div>

      {safariHistory.show ? (
        <div className={`settings-row settings-permission-row${screenRow ? "" : " settings-row--group-end"}`}>
          <div>
            <div className="settings-permission-title-line">
              <div className="lbl">{t("settings.permissions.safariHistory")}</div>
              <span className="ui-badge ui-badge--quiet settings-permission-requirement">{t("common.optional")}</span>
            </div>
            <div className="desc">
              {t("settings.permissions.safariHistoryDescription")}
              {safariHistory.readable ? (
                <> <OsSettingsLink label={openSettingsLabel} onOpen={() => void openOsSettings("safariHistory")} /></>
              ) : null}
            </div>
            {openFailedAlert("safariHistory")}
          </div>
          {safariHistory.readable ? <PermissionStatus label={t("common.enabled")} tone="success" /> : (
            <PermissionControl>
              <button
                type="button"
                className="settings-btn"
                disabled={safariHistory.opening}
                aria-busy={safariHistory.opening || undefined}
                onClick={() => safariHistory.onEnable()}
              >
                <ActionLabel busy={safariHistory.opening} busyLabel={t("settings.permissions.opening")}>
                  {t("settings.permissions.allowSafariHistory")}
                </ActionLabel>
              </button>
            </PermissionControl>
          )}
        </div>
      ) : null}
      {screenContextClient?.isDesktop() ? <ScreenRecordingPermissionRow client={screenContextClient} groupEnd showDiagnostics={showScreenDiagnostics} /> : null}
    </div>
  );
}
