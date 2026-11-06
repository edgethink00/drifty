import { useLocalization } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import { LockIcon, SHARE_FIELD_KEYS, SHARE_LEVEL_KEYS, WORK_LEVEL_KEYS, clockLabel, timeZoneLabel, weekdayShortLabel } from "./TeamSharingPolicyEditor";
import { TEAM_SHARE_FIELDS, workShareLevelOf, type TeamSharingPolicy, type TeamSharingWindow } from "./teamSharingPolicy";
import { TEAM_SHARING_EDITOR } from "./teamPreviewScenarios";
import { TEAM_LOCAL_TIMEZONE, computerTimeZone, type TeamTrackingPolicy } from "./teamSharingScope";

/** "Mon–Fri" for a run of days, "Mon · Wed · Fri" otherwise. */
export function describeSharingDays(days: readonly number[], language: DisplayLanguage): string {
  const sorted = [...days].sort((left, right) => left - right);
  if (sorted.length === 0) return "";
  const consecutive = sorted.every((day, index) => index === 0 || day === sorted[index - 1]! + 1);
  if (consecutive && sorted.length >= 3) return weekdayShortLabel(sorted[0]!, language) + "–" + weekdayShortLabel(sorted[sorted.length - 1]!, language);
  return sorted.map((day) => weekdayShortLabel(day, language)).join(" · ");
}

export type TeamPolicySummaryProps = {
  readonly policy: TeamSharingPolicy;
  readonly window: TeamSharingWindow | null;
  readonly tracking: TeamTrackingPolicy;
  readonly className?: string;
  /** Name the clock the hours follow (a Dev preview candidate); each person's local time is always named. */
  readonly showZone?: boolean;
  readonly detailed?: boolean;
};

/**
 * What a team shares, read only: the three items and the team summary, then
 * the hours, pausing and what is never shared. Invitees read this before
 * joining; members find it again in Team settings.
 */
export function TeamPolicySummary({ policy, window, tracking, className, showZone = false, detailed = false }: TeamPolicySummaryProps): JSX.Element {
  const { effectiveLanguage: language, t } = useLocalization();
  // The short form reads as the editor does: the work record and focus, unless items were set one by one.
  const work = TEAM_SHARING_EDITOR.read() !== "table" ? workShareLevelOf(policy) : null;
  const shortRows = !detailed && work !== null && work !== "custom";
  return (
    <div className={"team-policy-summary" + (className ? " " + className : "")}>
      <dl className="team-policy-summary__list">
        {shortRows ? (
          <>
            <div className="team-policy-summary__row">
              <dt>{t("team.policy.short.work")}</dt>
              <dd>{t(WORK_LEVEL_KEYS[work].title)}</dd>
            </div>
            <div className={"team-policy-summary__row" + (policy.focus === "off" ? " is-off" : "")}>
              <dt>{t("team.policy.short.focus")}</dt>
              <dd>{policy.focus === "off" ? t("team.policy.short.focusOff") : t("team.policy.short.focusOn")}</dd>
            </div>
          </>
        ) : TEAM_SHARE_FIELDS.map((field) => (
          <div key={field} className={"team-policy-summary__row" + (policy[field] === "off" ? " is-off" : "")}>
            <dt>{t(SHARE_FIELD_KEYS[field].title)}</dt>
            <dd>{t(SHARE_LEVEL_KEYS[policy[field]])}</dd>
          </div>
        ))}
        <div className="team-policy-summary__row">
          <dt>{t("team.policy.membersTitle")}</dt>
          <dd>{policy.memberSummary ? t("team.policy.memberSummaryOn") : t("team.policy.memberSummaryOff")}</dd>
        </div>
      </dl>
      <ul className="team-policy-summary__notes">
        {window ? <li>
          {showZone || window.timezone === TEAM_LOCAL_TIMEZONE || window.timezone !== computerTimeZone()
            ? t("team.policy.summary.hoursZone", {
              days: describeSharingDays(window.days, language),
              start: clockLabel(window.start_minute),
              end: clockLabel(window.end_minute),
              zone: window.timezone === TEAM_LOCAL_TIMEZONE ? t("team.policy.summary.zoneLocal") : timeZoneLabel(window.timezone, language),
            })
            : t("team.policy.summary.hours", {
              days: describeSharingDays(window.days, language),
              start: clockLabel(window.start_minute),
              end: clockLabel(window.end_minute),
            })}
        </li> : null}
        <li>{tracking === "managed" ? t("team.policy.summary.managed") : t("team.policy.summary.free")}</li>
        {policy.tasks !== "off" ? <li>{t("team.policy.summary.correct")}</li> : null}
        <li className="team-policy-summary__private"><LockIcon />{t("team.policy.neverShared")}</li>
      </ul>
    </div>
  );
}
