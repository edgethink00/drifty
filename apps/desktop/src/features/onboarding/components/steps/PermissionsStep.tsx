import { useContext, useEffect, useId, useState } from "react";
import { useLiveTrackingPreview } from "../../useLiveTrackingPreview";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { useLocalization } from "../../../localization/LocalizationContext";
import { ActionLabel } from "../../../../components/ActionLabel";
import { openSystemSettingsPane } from "../../../../lib/api/systemSettingsClient";
import { useAccessibilityPaneIsDeviceControl } from "../../../../lib/api/accessibilityPaneName";
import { ScreenRecordingOnboardingContext, type ScreenRecordingOnboardingChoice } from "../../../screen-context/ScreenRecordingOnboardingContext";
import { isMacScreenRecording, replayAppNames, requestScreenRecordingPermission, screenRecordingRequested, useScreenRecording } from "../../../screen-context/useScreenRecording";

export function PermissionsStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const accessibilityEnabled = !flow.accessibilityRequired || flow.accessibilityGranted;
  const notificationsEnabled = flow.notificationsReady;
  const safariHistory = flow.safariHistoryPermission;
  const screenRecording = useContext(ScreenRecordingOnboardingContext);
  const deviceControl = useAccessibilityPaneIsDeviceControl();
  // Live proof the permission works: show what tracking sees right now.
  const livePreview = useLiveTrackingPreview(accessibilityEnabled);

  return (
    <>
      <p className="dc-onb-copy">{t(flow.accessibilityRequired ? "onboarding.permissions.requiredFirst" : "onboarding.permissions.intro")}</p>
      {livePreview ? (
        <p className="dc-onb-live-note" role="status">
          {livePreview.kind === "current" ? (
            <>{t("onboarding.permissions.currentApp", { appName: livePreview.appName })}</>
          ) : livePreview.kind === "recent" ? (
            <>{t("onboarding.permissions.recentApp", { appName: livePreview.appName })}</>
          ) : (
            <>{t("onboarding.permissions.trackingOn")}</>
          )}
        </p>
      ) : null}
      <ul className="dc-onb-row-list">
        {flow.accessibilityRequired ? (
          <PermissionRow
            title={t(deviceControl ? "settings.permissions.deviceControl" : "settings.permissions.accessibility")}
            description={t("onboarding.permissions.accessibilityDescription")}
            icon="accessibility"
            priority="required"
            done={accessibilityEnabled}
            actionLabel={t("onboarding.permissions.allowInSettings")}
            disabled={false}
            onClick={() => void flow.handleRequestAccessibilityClick()}
          />
        ) : null}
        {/* The desktop notification plugin reports "granted" without asking the
            OS, so on macOS this row was a button that only flipped its own
            label. Windows keeps it: without the Accessibility row it would
            leave this step empty. */}
        {flow.accessibilityRequired ? null : (
          <PermissionRow
            title={t("onboarding.permissions.notifications")}
            description={t("onboarding.permissions.notificationsDescription")}
            icon="notifications"
            priority="recommended"
            done={notificationsEnabled}
            actionLabel={t("common.enable")}
            disabled={false}
            onClick={() => void flow.handleNotificationPermissionClick()}
          />
        )}
        {safariHistory.show ? (
          <PermissionRow
            icon="safari"
            title={t("onboarding.permissions.safariHistory")}
            description={t("onboarding.permissions.safariHistoryDescription")}
            priority="optional"
            done={safariHistory.readable}
            disabled={safariHistory.opening}
            actionLabel={t("onboarding.permissions.allowInSettings")}
            busy={safariHistory.opening}
            busyLabel={t("onboarding.permissions.opening")}
            onClick={safariHistory.onEnable}
          />
        ) : null}
        {screenRecording ? <ScreenRecordingRow choice={screenRecording} /> : null}
      </ul>
      {flow.accessibilityRequired && !accessibilityEnabled ? (
        <div className="dc-onb-permission-path">
          <strong>{t("onboarding.permissions.accessibilityRecoveryTitle")}</strong>
          <p>{t(deviceControl ? "onboarding.permissions.deviceControlRecoveryBody" : "onboarding.permissions.accessibilityRecoveryBody")}</p>
        </div>
      ) : null}
    </>
  );
}

/**
 * Optional screen recording. On macOS the button asks for the Screen Recording
 * permission (macOS answers by sending the person to System Settings, so it says
 * Allow in Settings like the other rows) and a grant is the choice to record;
 * Windows has no permission, so the row offers Turn on. The choice is saved once
 * onboarding starts tracking.
 */
function ScreenRecordingRow({ choice }: { readonly choice: ScreenRecordingOnboardingChoice }) {
  const { t } = useLocalization();
  const { current, busy, error, run } = useScreenRecording(choice.client);
  const [denied, setDenied] = useState(false);
  // A grant that follows this row's Allow (macOS relaunches Drifty after it) already
  // is the choice; App turns recording on once tracking starts. A grant made
  // without that press is only permission, so the row offers Turn on instead.
  const [permission, setPermission] = useState<"none" | "chosen" | "granted">("none");
  useEffect(() => {
    let alive = true;
    void Promise.all([choice.client.screenRecordingPermitted(), choice.client.wasConfigured()])
      .then(([permitted, configured]) => {
        if (alive) setPermission(!permitted || configured ? "none" : screenRecordingRequested() ? "chosen" : "granted");
      }).catch(() => undefined);
    return () => { alive = false; };
  }, [choice.client]);
  if (!current?.helperInstalled) return null;
  const mac = isMacScreenRecording(current);
  const asksPermission = mac && permission !== "granted";
  const apps = replayAppNames(current);
  // Only reached while Screen Recording is still off, so the drag-to-grant guide applies.
  const openSettings = () => { void openSystemSettingsPane("screenRecording", { guide: true }).catch(() => undefined); };
  const allow = () => void run(async () => {
    const granted = await requestScreenRecordingPermission(choice.client);
    setDenied(!granted);
    if (granted) choice.choose(); else openSettings();
  });
  return (
    <PermissionRow
      icon="screen"
      title={t("screenRecording.switch")}
      description={denied ? t("screenRecording.setup.permissionDenied")
        : error ? t("screenRecording.error")
        : current.generalCaptureSupported ? t("screenRecording.onboarding.descGeneral")
        : t(mac ? "screenRecording.onboarding.descMac" : "screenRecording.onboarding.descWindows", { apps })}
      priority="optional"
      done={choice.chosen || permission === "chosen" || current.preferences.enabled}
      doneLabel={mac ? undefined : t("common.enabled")}
      disabled={busy}
      busy={busy}
      actionLabel={asksPermission ? t("onboarding.permissions.allowInSettings") : t("screenRecording.permission.turnOn")}
      onClick={!asksPermission ? choice.choose : denied ? openSettings : allow}
    />
  );
}

/** Priority badges follow Settings > Permissions: the shared .ui-badge ladder beside the title. */
const PRIORITY_BADGE = {
  required: { className: "ui-badge", labelKey: "common.required" },
  recommended: { className: "ui-badge", labelKey: "common.recommended" },
  optional: { className: "ui-badge ui-badge--outline", labelKey: "common.optional" },
} as const;

function PermissionRow({
  actionLabel,
  busy = false,
  busyLabel,
  description,
  disabled,
  done,
  doneLabel,
  icon,
  onClick,
  priority,
  title,
}: {
  readonly actionLabel: string;
  /** The row's request is in flight. */
  readonly busy?: boolean;
  /** Shown beside the spinner while busy; its width is reserved, so the button never grows. */
  readonly busyLabel?: string;
  readonly description: string;
  readonly disabled: boolean;
  /** Once on, the row shows a status (a dot and "Enabled") in place of its button. */
  readonly done: boolean;
  /** Replaces "Allowed" when the row turns something on rather than granting a permission. */
  readonly doneLabel?: string;
  readonly icon: "accessibility" | "notifications" | "safari" | "screen";
  readonly onClick: () => void;
  readonly priority: keyof typeof PRIORITY_BADGE;
  readonly title: string;
}) {
  const { t } = useLocalization();
  const titleId = useId();
  const badge = PRIORITY_BADGE[priority];
  const tone = done ? "success" : priority === "required" ? "required" : "neutral";
  return (
    <li className={`dc-onb-row dc-onb-row--${tone}`}>
      <span className="dc-onb-permission-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {icon === "accessibility" ? <><circle cx="12" cy="4" r="2" /><path d="M4 9h16M12 7v7m0 0-5 7m5-7 5 7" /></>
            : icon === "safari" ? <><circle cx="12" cy="12" r="9" /><path d="m16 8-2 6-6 2 2-6 6-2Z" /></>
            : icon === "screen" ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>
            : <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>}
        </svg>
      </span>
      <div className="dc-onb-row__copy">
        <span className="dc-onb-row__title dc-onb-row__title--with-priority">
          <span id={titleId}>{title}</span>
          <span className={badge.className}>{t(badge.labelKey)}</span>
        </span>
        <span className="dc-onb-row__desc">{description}</span>
      </div>
      <div className="dc-onb-row__action">
        {done ? (
          <span className="dc-onb-permission-status">{doneLabel ?? t("onboarding.permissions.allowed")}</span>
        ) : (
          <button type="button" className="dc-onb-secondary-button" onClick={onClick} disabled={disabled} aria-busy={busy || undefined} aria-describedby={titleId}>
            <ActionLabel busy={busy} busyLabel={busyLabel}>{actionLabel}</ActionLabel>
          </button>
        )}
      </div>
    </li>
  );
}
