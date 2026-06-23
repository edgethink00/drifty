import type { NotificationPermissionState } from "../../onboardingFlow";

type NotificationsStepProps = {
  readonly notificationPermission: NotificationPermissionState;
  readonly notificationsReady: boolean;
  readonly openingSettingsPane: "accessibility" | "notifications" | null;
  readonly onNotificationPermission: () => void;
  readonly onOpenNotificationSettings: () => void;
};

export function NotificationsStep({
  notificationPermission,
  notificationsReady,
  openingSettingsPane,
  onNotificationPermission,
  onOpenNotificationSettings,
}: NotificationsStepProps) {
  return (
    <>
      <span className={`onb-status-pill${notificationsReady ? " onb-status-pill--ready" : ""}`}>
        {notificationPermission === "unavailable"
          ? "Preview"
          : notificationsReady
            ? "Granted"
            : notificationPermission === "denied"
              ? "Waiting"
              : "Required"}
      </span>
      <p className="onb-step-desc">
        drifty only nudges you when a drift lasts long enough to matter.
      </p>
      <div className="onb-setup-card__actions">
        <button
          type="button"
          className="onb-button onb-button--primary"
          onClick={onNotificationPermission}
          disabled={
            notificationPermission === "checking" ||
            notificationPermission === "granted" ||
            notificationPermission === "unavailable"
          }
        >
          {notificationPermission === "checking"
            ? "Checking…"
            : notificationPermission === "granted"
              ? "Notifications ready"
              : notificationPermission === "unavailable"
                ? "Unavailable here"
                : notificationPermission === "denied"
                  ? "Check again"
                  : "Request permission"}
        </button>
        {notificationPermission === "denied" ? (
          <button
            type="button"
            className="onb-button onb-button--ghost"
            onClick={onOpenNotificationSettings}
            disabled={openingSettingsPane === "notifications"}
          >
            {openingSettingsPane === "notifications" ? "Opening…" : "Open Notification settings"}
          </button>
        ) : null}
      </div>
    </>
  );
}
