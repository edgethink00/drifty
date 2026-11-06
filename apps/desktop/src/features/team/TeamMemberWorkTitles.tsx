import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDayLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { TEAM_UNASSIGNED_COLOR, TeamCard } from "./TeamFocusParts";
import type { TeamWorkTitleDay } from "./teamWorkBlocks";
import type { TeamProject } from "./teamTypes";

/**
 * A person's work titles by day, as their team shares them: each block's name from their own
 * day with its time, biggest first. The person reads the same list on their own page, with how
 * to correct a name.
 */
export function TeamMemberWorkTitles({ days, projects, self }: {
  readonly days: readonly TeamWorkTitleDay[];
  readonly projects: readonly TeamProject[];
  readonly self: boolean;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const color = (id: string | null) => projects.find((project) => project.id === id)?.color ?? TEAM_UNASSIGNED_COLOR;
  return (
    <TeamCard id="team-member-titles-heading" title={t("team.member.workTitles")} className="team-card--titles">
      {days.length === 0 ? <div className="team-empty">{t("team.member.noWorkTitles")}</div> : (
        <div className="team-titles">
          {days.map((day) => (
            <section key={day.day} className="team-titles__day" aria-label={formatLocalizedDayLabel(day.day, effectiveLanguage)}>
              <h4 className="team-titles__date">{formatLocalizedDayLabel(day.day, effectiveLanguage)}</h4>
              <ul className="team-shifts team-titles__list">
                {day.items.map((item) => (
                  <li key={item.title} className="team-shifts__row team-titles__row">
                    <span className="projects-share__swatch" style={{ background: color(item.projectId) }} />
                    <span className="team-shifts__text team-titles__name" title={item.title}>{item.title}</span>
                    <span className="team-shifts__delta">{formatLocalizedCompactDurationFromSeconds(item.seconds, effectiveLanguage)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {self ? <p className="team-titles__note">{t("team.member.workTitlesSelfNote")}</p> : null}
    </TeamCard>
  );
}
