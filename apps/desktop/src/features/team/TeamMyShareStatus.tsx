import { formatLocalizedCompactDurationFromSeconds, formatRelativeTime, localeForDisplayLanguage } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { TeamAutoShareIdleReason } from "./teamAutoShare";
import { useTeamShareStatus } from "./teamShareStatus";
import { computerTimeZone } from "./teamSharingScope";

const REASON_KEYS: Record<TeamAutoShareIdleReason, TranslationKey> = {
  "nothing-shared": "team.shareStatus.reason.nothing-shared",
  "no-hours": "team.shareStatus.reason.no-hours",
  "not-joined": "team.shareStatus.reason.not-joined",
  "outside-hours": "team.shareStatus.reason.outside-hours",
  "no-records": "team.shareStatus.reason.no-records",
};

export type TeamMyShareStatusProps = {
  readonly accountKey: string | null;
  readonly organizationId: string | null;
  /** The zone the team's hours are stored in. */
  readonly hoursTimeZone: string | null;
};

/**
 * Team settings › My sharing (owner decision 2026-11-08): when this computer last
 * sent the member's time, how much went up over the last week, and why the latest
 * pass sent nothing or failed, including team hours left in UTC.
 */
export function TeamMyShareStatus({ accountKey, organizationId, hoursTimeZone }: TeamMyShareStatusProps): JSX.Element | null {
  const { effectiveLanguage: language, t } = useLocalization();
  const status = useTeamShareStatus(accountKey, organizationId);
  if (!accountKey || !organizationId) return null;
  const zone = computerTimeZone();
  const utcHours = hoursTimeZone === "UTC" && zone !== "UTC" && zone !== "Etc/UTC";
  const note = !status
    ? t("team.shareStatus.notChecked")
    : status.outcome === "failed"
      ? t("team.shareStatus.failed", { error: status.error ?? "" })
      : status.outcome === "nothing" && status.reason
        ? t(REASON_KEYS[status.reason])
        : null;
  return (
    <section className="team-set-section team-share-status" aria-label={t("team.shareStatus.heading")}>
      <span className="label-mono">{t("team.shareStatus.heading")}</span>
      <dl className="team-policy-summary__list">
        <div className={"team-policy-summary__row" + (status?.sharedAt ? "" : " is-off")}>
          <dt>{t("team.shareStatus.lastShared")}</dt>
          <dd>{status?.sharedAt ? formatRelativeTime(status.sharedAt, localeForDisplayLanguage(language)) : t("team.shareStatus.never")}</dd>
        </div>
        <div className={"team-policy-summary__row" + (status?.recentSeconds ? "" : " is-off")}>
          <dt>{t("team.shareStatus.recent")}</dt>
          <dd>{status?.recentSeconds ? formatLocalizedCompactDurationFromSeconds(status.recentSeconds, language) : "—"}</dd>
        </div>
      </dl>
      {note ? <p className={"team-modal__hint" + (status?.outcome === "failed" ? " is-warning" : "")}>{note}</p> : null}
      {utcHours ? <p className="team-modal__hint is-warning">{t("team.shareStatus.utcZone", { zone })}</p> : null}
    </section>
  );
}
