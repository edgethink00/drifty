import type { NotificationPermissionState } from "../../onboardingFlow";

type PermissionsStepProps = {
  readonly accessibilityGranted: boolean;
  readonly accessibilityReady: boolean;
  readonly notificationPermission: NotificationPermissionState;
  readonly notificationsReady: boolean;
  readonly openingSettingsPane: "accessibility" | "notifications" | null;
  readonly onNotificationPermission: () => void;
  readonly onRequestAccessibility: () => void;
};

export function PermissionsStep({
  accessibilityGranted,
  accessibilityReady,
  notificationPermission,
  notificationsReady,
  openingSettingsPane,
  onNotificationPermission,
  onRequestAccessibility,
}: PermissionsStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        Drifty needs a few Mac permissions to understand your focus and drift patterns.
      </p>
      <ul className="onb-perms" aria-label="Required permissions">
        <li className="onb-perms__row">
          <div className="onb-perms__info">
            <span className="onb-perms__name">Accessibility</span>
            <span className="onb-perms__desc">Lets Drifty understand active apps and windows.</span>
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
            <span className="onb-perms__desc">Lets Drifty send gentle focus nudges and useful setup alerts.</span>
          </div>
          <div className="onb-perms__control">
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
      </ul>
    </>
  );
}
