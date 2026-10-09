import { useLiveTrackingPreview } from "../../useLiveTrackingPreview";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { useLocalization } from "../../../localization/LocalizationContext";

export function PermissionsStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const accessibilityEnabled = !flow.accessibilityRequired || flow.accessibilityGranted;
  const notificationsEnabled = flow.notificationsReady;
  const safariHistory = flow.safariHistoryPermission;
  // Live proof the permission works: show what tracking sees right now.
  const livePreview = useLiveTrackingPreview(accessibilityEnabled);

  return (
    <>
      <p className="dc-onb-copy">{t("onboarding.permissions.intro")}</p>
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
            title={t("settings.permissions.accessibility")}
            description={t("onboarding.permissions.accessibilityDescription")}
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
            priority="recommended"
            done={notificationsEnabled}
            actionLabel={t("common.enable")}
            disabled={false}
            onClick={() => void flow.handleNotificationPermissionClick()}
          />
        )}
        {safariHistory.show ? (
          <PermissionRow
            title={t("onboarding.permissions.safariHistory")}
            description={t("onboarding.permissions.safariHistoryDescription")}
            priority="optional"
            done={safariHistory.readable}
            disabled={safariHistory.opening}
            actionLabel={safariHistory.opening ? t("onboarding.permissions.opening") : t("common.enable")}
            onClick={safariHistory.onEnable}
          />
        ) : null}
      </ul>
      {flow.accessibilityRequired && !accessibilityEnabled ? (
        <div className="dc-onb-permission-path">
          <strong>{t("onboarding.permissions.accessibilityRecoveryTitle")}</strong>
          <p>{t("onboarding.permissions.accessibilityRecoveryBody")}</p>
        </div>
      ) : null}
    </>
  );
}

/** Priority badges follow Settings > Permissions: the shared .ui-badge ladder beside the title. */
const PRIORITY_BADGE = {
  required: { className: "ui-badge ui-badge--warn", labelKey: "common.required" },
  recommended: { className: "ui-badge", labelKey: "common.recommended" },
  optional: { className: "ui-badge ui-badge--quiet", labelKey: "common.optional" },
} as const;

function PermissionRow({
  actionLabel,
  description,
  disabled,
  done,
  onClick,
  priority,
  title,
}: {
  readonly actionLabel: string;
  readonly description: string;
  readonly disabled: boolean;
  /** Once on, the row shows a status (a dot and "Enabled") in place of its button. */
  readonly done: boolean;
  readonly onClick: () => void;
  readonly priority: keyof typeof PRIORITY_BADGE;
  readonly title: string;
}) {
  const { t } = useLocalization();
  const badge = PRIORITY_BADGE[priority];
  const tone = done ? "success" : priority === "required" ? "required" : "neutral";
  return (
    <li className={`dc-onb-row dc-onb-row--${tone}`}>
      <span className="dc-onb-permission-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {done ? <path d="m5 12 4 4L19 6" /> : <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="M12 8v5m0 3h.01" /></>}
        </svg>
      </span>
      <div className="dc-onb-row__copy">
        <span className="dc-onb-row__title dc-onb-row__title--with-priority">
          {title}
          <span className={badge.className}>{t(badge.labelKey)}</span>
        </span>
        <span className="dc-onb-row__desc">{description}</span>
      </div>
      <div className="dc-onb-row__action">
        {done ? (
          <span className="dc-onb-permission-status">{t("onboarding.permissions.allowed")}</span>
        ) : (
          <button type="button" className="dc-onb-secondary-button" onClick={onClick} disabled={disabled}>
            {actionLabel}
          </button>
        )}
      </div>
    </li>
  );
}
