import { useLocalization } from "../localization/LocalizationContext";
import { TeamCard } from "./TeamFocusParts";

const CHECK = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.4 2.9 2.8 6.1-6.4" /></svg>;

export type TeamGettingStartedProps = {
  readonly projectCount: number;
  readonly onInvite: () => void;
  readonly onProjects: () => void;
};

/**
 * A team with only the person who made it has nothing to show yet, so its
 * Overview names the two things that start it, each with its action, instead
 * of a zero headline and empty charts (2026-10-25). The usual Overview returns
 * as soon as someone joins.
 */
export function TeamGettingStarted({ projectCount, onInvite, onProjects }: TeamGettingStartedProps): JSX.Element {
  const { t } = useLocalization();
  const projectsDone = projectCount > 0;
  return (
    <TeamCard id="team-start-heading" title={t("team.start.title")} className="team-start">
      <ol className="team-start__steps">
        <li className="team-start__step">
          <span className="team-start__mark" aria-hidden="true">1</span>
          <span className="team-start__copy">
            <strong>{t("team.start.invite")}</strong>
            <span>{t("team.start.inviteBody")}</span>
          </span>
          <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={onInvite}>{t("team.nav.inviteTeammate")}</button>
        </li>
        <li className={"team-start__step" + (projectsDone ? " is-done" : "")}>
          <span className="team-start__mark" aria-hidden="true">{projectsDone ? CHECK : "2"}</span>
          <span className="team-start__copy">
            <strong>{t("team.start.projects")}</strong>
            <span>{projectsDone ? t("team.start.projectsDone", { count: projectCount }) : t("team.start.projectsBody")}</span>
          </span>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onProjects}>
            {projectsDone ? t("team.start.projectsOpen") : t("team.start.projectsAction")}
          </button>
        </li>
      </ol>
    </TeamCard>
  );
}

