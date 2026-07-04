import type { NotificationPermissionState } from "../../onboardingFlow";

type PermissionsStepProps = {
  readonly accessibilityGranted: boolean;
  readonly accessibilityReady: boolean;
  readonly notificationPermission: NotificationPermissionState;
  readonly notificationsReady: boolean;
  readonly openingSettingsPane: "accessibility" | "notifications" | null;
  readonly onNotificationPermission: () => void;
  readonly onRequestAccessibility: () => void;
  readonly safariHistoryShow?: boolean;
  readonly safariHistoryReadable?: boolean;
  readonly safariHistoryOpening?: boolean;
  readonly onEnableSafariHistory?: () => void;
};

export function PermissionsStep({
  accessibilityGranted,
  accessibilityReady,
  notificationPermission,
  notificationsReady,
  openingSettingsPane,
  onNotificationPermission,
  onRequestAccessibility,
  safariHistoryShow = false,
  safariHistoryReadable = false,
  safariHistoryOpening = false,
  onEnableSafariHistory,
}: PermissionsStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        Drifty needs a couple of Mac permissions to see your focus and drift patterns. Everything is processed for your
        own timeline.
      </p>
      <ul className="onb-perms" aria-label="Required permissions">
        <li className="onb-perms__row">
          <div className="onb-perms__info">
            <span className="onb-perms__name">Accessibility</span>
            <span className="onb-perms__desc">Lets Drifty see your active app and window — required to track at all.</span>
          </div>
          <div className="onb-perms__control">
            <span className={`onb-status-pill${accessibilityReady ? " onb-status-pill--ready" : ""}`}>
              {accessibilityGranted ? "Enabled" : accessibilityReady ? "Ready" : "Required"}
            </span>
            <button
              type="button"
              className="onb-button onb-button--ghost onb-perms__action"
              onClick={onRequestAccessibility}
              disabled={openingSettingsPane === "accessibility" || accessibilityReady}
            >
              {openingSettingsPane === "accessibility"
                ? "Opening…"
                : accessibilityReady
                  ? accessibilityGranted
                    ? "Enabled"
                    : "Ready"
                  : "Enable"}
            </button>
          </div>
        </li>
        <li className="onb-perms__row">
          <div className="onb-perms__info">
            <span className="onb-perms__name">Notifications</span>
            <span className="onb-perms__desc">Lets Drifty send gentle focus nudges and setup alerts.</span>
          </div>
          <div className="onb-perms__control">
            <span className={`onb-status-pill${notificationsReady ? " onb-status-pill--ready" : ""}`}>
              {notificationsReady ? "Enabled" : "Recommended"}
            </span>
            <button
              type="button"
              className="onb-button onb-button--ghost onb-perms__action"
              onClick={onNotificationPermission}
              disabled={notificationPermission === "checking" || notificationsReady}
            >
              {notificationsReady ? "Enabled" : "Enable"}
            </button>
          </div>
        </li>
        {safariHistoryShow ? (
          <li className="onb-perms__row">
            <div className="onb-perms__info">
              <span className="onb-perms__name">Safari history</span>
              <span className="onb-perms__desc">
                Lets Drifty import your Safari browsing history — needs Full Disk Access.
              </span>
            </div>
            <div className="onb-perms__control">
              <span className={`onb-status-pill${safariHistoryReadable ? " onb-status-pill--ready" : ""}`}>
                {safariHistoryReadable ? "Enabled" : "Optional"}
              </span>
              <button
                type="button"
                className="onb-button onb-button--ghost onb-perms__action"
                onClick={onEnableSafariHistory}
                disabled={safariHistoryOpening || safariHistoryReadable}
              >
                {safariHistoryReadable ? "Enabled" : safariHistoryOpening ? "Opening…" : "Enable"}
              </button>
            </div>
          </li>
        ) : null}
      </ul>
    </>
  );
}
