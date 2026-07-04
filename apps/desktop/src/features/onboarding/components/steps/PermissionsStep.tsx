import { useLiveTrackingPreview } from "../../useLiveTrackingPreview";
import type { OnboardingFlow } from "../../useOnboardingFlow";

export function PermissionsStep({ flow }: { readonly flow: OnboardingFlow }) {
  const accessibilityEnabled = flow.accessibilityGranted;
  const notificationsEnabled = flow.notificationsReady;
  const safariHistory = flow.safariHistoryPermission;
  // Live proof the permission works: show what tracking sees right now.
  const liveAppName = useLiveTrackingPreview(accessibilityEnabled);

  return (
    <>
      <p className="dc-onb-copy">
        Drifty needs a couple of Mac permissions to see your focus and drift patterns. Everything is processed for your own timeline.
      </p>
      {liveAppName ? (
        <p className="dc-onb-live-note" role="status">
          I can see you&apos;re in <strong>{liveAppName}</strong> right now — tracking works.
        </p>
      ) : null}
      <ul className="dc-onb-row-list">
        <PermissionRow
          title="Accessibility"
          description="Lets Drifty see your active app and window — required to track at all."
          pill={accessibilityEnabled ? "Enabled" : "Required"}
          tone={accessibilityEnabled ? "success" : "required"}
          disabled={accessibilityEnabled}
          onClick={() => void flow.handleRequestAccessibilityClick()}
        />
        <PermissionRow
          title="Notifications"
          description="Lets Drifty send gentle focus nudges and setup alerts."
          pill={notificationsEnabled ? "Enabled" : "Recommended"}
          tone={notificationsEnabled ? "success" : "neutral"}
          disabled={notificationsEnabled}
          onClick={() => void flow.handleNotificationPermissionClick()}
        />
        {safariHistory.show ? (
          <PermissionRow
            title="Safari history"
            description="Lets Drifty import your Safari browsing history — needs Full Disk Access."
            pill={safariHistory.readable ? "Enabled" : "Optional"}
            tone={safariHistory.readable ? "success" : "neutral"}
            disabled={safariHistory.opening || safariHistory.readable}
            actionLabel={safariHistory.readable ? "Enabled" : safariHistory.opening ? "Opening…" : "Enable"}
            onClick={safariHistory.onEnable}
          />
        ) : null}
      </ul>
    </>
  );
}

function PermissionRow({
  actionLabel,
  description,
  disabled,
  onClick,
  pill,
  title,
  tone,
}: {
  readonly actionLabel?: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly pill: string;
  readonly title: string;
  readonly tone: "success" | "required" | "neutral";
}) {
  return (
    <li className="dc-onb-row">
      <div className="dc-onb-row__copy">
        <span className="dc-onb-row__title">{title}</span>
        <span className="dc-onb-row__desc">{description}</span>
      </div>
      <div className="dc-onb-row__action">
        <span className={`dc-onb-pill dc-onb-pill--${tone}`}>{pill}</span>
        <button type="button" className="dc-onb-secondary-button" onClick={onClick} disabled={disabled}>
          {actionLabel ?? (disabled ? "Enabled" : "Enable")}
        </button>
      </div>
    </li>
  );
}
