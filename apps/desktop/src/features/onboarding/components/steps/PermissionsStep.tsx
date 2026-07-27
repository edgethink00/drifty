import { useLiveTrackingPreview } from "../../useLiveTrackingPreview";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { useLocalization } from "../../../localization/LocalizationContext";

export function PermissionsStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const accessibilityEnabled = flow.accessibilityGranted;
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
        <PermissionRow
          title={t("settings.permissions.accessibility")}
          description={t("onboarding.permissions.accessibilityDescription")}
          pill={accessibilityEnabled ? t("onboarding.permissions.allowed") : t("common.required")}
          tone={accessibilityEnabled ? "success" : "required"}
          disabled={accessibilityEnabled}
          onClick={() => void flow.handleRequestAccessibilityClick()}
        />
        <PermissionRow
          title={t("onboarding.permissions.notifications")}
          description={t("onboarding.permissions.notificationsDescription")}
          pill={notificationsEnabled ? t("onboarding.permissions.allowed") : t("common.recommended")}
          tone={notificationsEnabled ? "success" : "neutral"}
          disabled={notificationsEnabled}
          onClick={() => void flow.handleNotificationPermissionClick()}
        />
        {safariHistory.show ? (
          <PermissionRow
            title={t("onboarding.permissions.safariHistory")}
            description={t("onboarding.permissions.safariHistoryDescription")}
            pill={safariHistory.readable ? t("onboarding.permissions.allowed") : t("common.optional")}
            tone={safariHistory.readable ? "success" : "neutral"}
            disabled={safariHistory.opening || safariHistory.readable}
            actionLabel={safariHistory.readable ? t("onboarding.permissions.allowed") : safariHistory.opening ? t("onboarding.permissions.opening") : t("common.enable")}
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
  const { t } = useLocalization();
  return (
    <li className="dc-onb-row">
      <div className="dc-onb-row__copy">
        <span className="dc-onb-row__title">{title}</span>
        <span className="dc-onb-row__desc">{description}</span>
      </div>
      <div className="dc-onb-row__action">
        <span className={`dc-onb-pill dc-onb-pill--${tone}`}>{pill}</span>
        <button type="button" className="dc-onb-secondary-button" onClick={onClick} disabled={disabled}>
          {actionLabel ?? (disabled ? t("onboarding.permissions.allowed") : t("common.enable"))}
        </button>
      </div>
    </li>
  );
}
