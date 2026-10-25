import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { TeamMemberCardModel } from "./teamFocusModel";
import { LockIcon, SHARE_FIELD_KEYS, SHARE_LEVEL_KEYS } from "./TeamSharingPolicyEditor";
import { TEAM_SHARE_FIELDS, shareLevelRank, teamSharingVisibility, type TeamShareField, type TeamSharingPolicy } from "./teamSharingPolicy";

export type TeamMemberSelfShareProps = {
  /** The member's own team's policy. */
  readonly policy: TeamSharingPolicy;
  /** The member's own card for this period; null before their records load. */
  readonly card: TeamMemberCardModel | null;
  /** Opens the member's own page: the same page their managers open. */
  readonly onOpen: () => void;
};

const TEAM_LEVEL_NOTE: Readonly<Record<TeamShareField, TranslationKey>> = {
  projects: "team.selfShare.teamOnly",
  tasks: "team.selfShare.teamOnly",
  focus: "team.selfShare.teamOnly",
};

/**
 * Candidate A for a member: what their managers see of them, item by item,
 * with this period's figure where an item is shared per person. The page it
 * links to is the one managers open, so a member can check it for themself.
 */
export function TeamMemberSelfShare({ policy, card, onOpen }: TeamMemberSelfShareProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const personal = teamSharingVisibility(policy).personal;
  const projectSeconds = card ? card.projects.filter((share) => share.projectId !== null).reduce((sum, share) => sum + share.seconds, 0) : 0;
  const detail = (field: TeamShareField): string | null => {
    const level = policy[field];
    if (level === "off") return null;
    if (level === "team") return t(TEAM_LEVEL_NOTE[field]);
    if (field === "projects") {
      if (!card || projectSeconds === 0) return t("team.selfShare.nothingYet");
      const top = card.topProject && card.topProject.projectId !== null ? card.topProject : null;
      return top
        ? t("team.selfShare.projects", { project: top.name ?? "", duration: duration(projectSeconds) })
        : duration(projectSeconds);
    }
    if (field === "tasks") return shareLevelRank(level) >= 3 ? t("team.selfShare.tasksHourly") : t("team.selfShare.tasks");
    if (!card || card.focusSeconds === 0) return t("team.selfShare.nothingYet");
    return t("team.selfShare.focus", { duration: duration(card.focusSeconds) });
  };
  return (
    <section className="team-self-share" aria-labelledby="team-self-share-title">
      <header className="team-self-share__head">
        <h3 id="team-self-share-title" className="team-focus__section-title label-mono">{t("team.selfShare.title")}</h3>
        {personal ? (
          <button type="button" className="team-self-share__open" onClick={onOpen}>
            {t("team.selfShare.open")}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        ) : null}
      </header>
      <dl className="team-self-share__list">
        {TEAM_SHARE_FIELDS.map((field) => {
          const text = detail(field);
          return (
            <div key={field} className={"team-self-share__row" + (policy[field] === "off" ? " is-off" : "")}>
              <dt>{t(SHARE_FIELD_KEYS[field].title)}</dt>
              <dd className="team-self-share__level">{policy[field] === "off" ? <><LockIcon />{t(SHARE_LEVEL_KEYS.off)}</> : t(SHARE_LEVEL_KEYS[policy[field]])}</dd>
              <dd className="team-self-share__detail">{text ?? ""}</dd>
            </div>
          );
        })}
      </dl>
      {personal ? null : <p className="team-self-share__note">{t("team.selfShare.noPersonal")}</p>}
    </section>
  );
}

/** Candidate B: one line under the member's own card naming each item's level. */
export function TeamMemberSelfShareLine({ policy }: { readonly policy: TeamSharingPolicy }): JSX.Element {
  const { t } = useLocalization();
  return (
    <p className="team-self-share-line">
      <span className="team-self-share-line__lead">{t("team.selfShare.lineLead")}</span>
      {TEAM_SHARE_FIELDS.map((field, index) => (
        <span key={field} className={policy[field] === "off" ? "is-off" : undefined}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {t(SHARE_FIELD_KEYS[field].title)} {t(SHARE_LEVEL_KEYS[policy[field]])}
        </span>
      ))}
    </p>
  );
}

