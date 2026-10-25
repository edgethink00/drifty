import { useEffect, useRef } from "react";

import { MetricTile } from "../../components/MetricTile";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDateRangeLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { TeamCard, TeamTrendChart } from "./TeamFocusParts";
import { previousWindow, type TeamMemberDetailModel, type TeamProjectShare, type TeamWindow } from "./teamFocusModel";

export const TEAM_MEMBER_PROJECT_DETAIL_ID = "team-member-project-detail";

/** A single selected project's daily flow and comparison, never a second all-project list. */
export function TeamMemberProjectDetail({ model, project, window: range, onClose }: {
  readonly model: TeamMemberDetailModel;
  readonly project: TeamProjectShare;
  readonly window: TeamWindow;
  readonly onClose: () => void;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const detailRef = useRef<HTMLDivElement>(null);
  const previous = previousWindow(range);
  const previousSeconds = model.previousProjects.find((share) => share.projectId === project.projectId)?.seconds ?? 0;
  const delta = project.seconds - previousSeconds;
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const name = project.name ?? t("team.focus.unassigned");
  useEffect(() => {
    detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  }, []);
  return (
    <div id={TEAM_MEMBER_PROJECT_DETAIL_ID} ref={detailRef} className="team-project-detail">
      <TeamCard id="team-project-detail-heading" title={name} aside={<button type="button" className="team-icon-btn" aria-label={t("team.member.closeProjectDetail")} onClick={onClose}>×</button>}>
        <div className="team-project-detail__body">
          <div className="team-project-detail__chart">
            <p className="label-mono">{t("team.focus.projectByDay")}</p>
            <TeamTrendChart days={model.dayRows.map((day) => ({ day: day.day, shares: day.isFuture ? [] : day.shares.filter((share) => share.projectId === project.projectId) }))} order={[project]} language={effectiveLanguage} ariaLabel={t("team.focus.ledgerTrendAria", { project: name })} unassignedLabel={t("team.focus.unassigned")} />
          </div>
          <div className="team-project-detail__comparison">
            <MetricTile label={t("team.member.projectCurrent")} value={duration(project.seconds)} detail={formatLocalizedDateRangeLabel(range.start_date, range.end_date, effectiveLanguage)} />
            <MetricTile label={t("team.member.projectPrevious")} value={duration(previousSeconds)} detail={formatLocalizedDateRangeLabel(previous.start_date, previous.end_date, effectiveLanguage)} />
            <MetricTile label={t("team.focus.col.change")} value={previousSeconds > 0 ? (delta > 0 ? "+" : delta < 0 ? "−" : "") + duration(Math.abs(delta)) : "—"} detail={previousSeconds <= 0 ? t("team.member.projectNoPrevious") : undefined} />
          </div>
        </div>
      </TeamCard>
    </div>
  );
}
