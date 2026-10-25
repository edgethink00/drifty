import { MetricTile } from "../../components/MetricTile";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDayLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { TeamCard, hourAxisLabel } from "./TeamFocusParts";
import type { TeamMemberDetailModel, TeamWindow } from "./teamFocusModel";
import { memberCalendarHours, memberFocusRhythm } from "./teamMemberWorkView";
import type { TeamProject } from "./teamTypes";
import type { TeamMemberHistoryPosition } from "./teamPreviewScenarios";
import { TeamMemberCalendar } from "./TeamMemberCalendar";

const clock = (minute: number) => String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");

/** The complete member screen is the reference for subtracting lower sharing scopes. */
export function TeamMemberWorkspaceView({ model, projects, window, nowMinuteOfDay, dayChart, projectPanel, projectDetail, history, historyPosition = "below" }: {
  readonly model: TeamMemberDetailModel;
  readonly projects: readonly TeamProject[];
  readonly window: TeamWindow;
  readonly nowMinuteOfDay: number;
  readonly dayChart: JSX.Element;
  readonly projectPanel: JSX.Element;
  readonly projectDetail: JSX.Element | null;
  readonly history: JSX.Element;
  readonly historyPosition?: TeamMemberHistoryPosition;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const tracked = model.dayRows.filter((row) => !row.isFuture && row.tracked).length;
  const expected = model.dayRows.filter((row) => !row.isFuture && row.expected).length;
  // Focus figures only where focus is shared. Without it, a count of projects and of days
  // with project time would repeat the share panel's rows and the day chart's columns.
  const summary = model.focusVisible ? (
    <div className="team-member-workspace__metrics" role="group" aria-label={t("team.member.summary")}>
      <MetricTile label={t("team.focus.figure.focus")} value={duration(model.focusSeconds)} detail={t("team.member.recordedDays", { count: tracked })} />
      <MetricTile label={t("team.member.dailyAverage")} value={tracked > 0 ? duration(model.focusSeconds / tracked) : "—"} detail={t("team.member.perRecordedDay")} />
      <MetricTile label={t("team.member.deepBlocks")} value={String(model.deepBlockCount)} detail={t("team.member.deepThreshold")} />
      <MetricTile label={t("team.member.longestBlock")} value={model.longestBlockSeconds > 0 ? duration(model.longestBlockSeconds) : "—"} detail={model.blocksVisible && model.longestBlockDay ? formatLocalizedDayLabel(model.longestBlockDay, effectiveLanguage) + (model.longestBlockStartMinute !== null ? " · " + clock(model.longestBlockStartMinute) : "") : t("team.member.inThisPeriod")} />
    </div>
  ) : null;
  return (
    <div className="team-member-workspace">
      <div className={"team-member-workspace__primary" + (model.blocksVisible ? " has-calendar" : "")}>
        {/* The hourly rhythm reads the calendar's hours, so it follows the calendar in the same
            column; placed under the whole row it waited for the taller rail and left a hole. */}
        <div className="team-member-workspace__timeline">
          {model.blocksVisible ? (
            <>
              <TeamMemberCalendar key={model.member.member_key + window.start_date + window.end_date} model={model} projects={projects} nowMinuteOfDay={nowMinuteOfDay} />
              <MemberRhythm model={model} />
            </>
          ) : dayChart}
        </div>
        <aside className="team-rail team-member-workspace__rail" aria-label={t("team.focus.railAria")}>
          {model.blocksVisible && historyPosition === "above" ? history : null}
          {projectPanel}
          {model.blocksVisible && historyPosition === "below" ? history : null}
          {summary}
          {model.focusVisible && expected > 0 && tracked < expected ? <p className="team-member-workspace__coverage">{t("team.focus.trackedDays", { tracked, expected })}</p> : null}
        </aside>
      </div>
      {projectDetail}
      {model.blocksVisible ? null : <div className="team-member-workspace__secondary">{history}</div>}
    </div>
  );
}

function MemberRhythm({ model }: { readonly model: TeamMemberDetailModel }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const seconds = memberFocusRhythm(model);
  const hours = memberCalendarHours(model.dayRows);
  const max = Math.max(1, ...seconds);
  const peakHour = seconds.indexOf(Math.max(...seconds));
  return (
    <TeamCard id="team-member-rhythm-heading" title={t("team.member.focusRhythm")} className="team-member-rhythm">
      <div className="team-member-rhythm__bars" role="img" aria-label={t("team.member.rhythmAria", { name: model.member.display_name })}>
        {seconds.slice(hours.start, hours.end).map((value, index) => <div key={index} className="team-member-rhythm__col" title={hourAxisLabel(index + hours.start, effectiveLanguage) + " · " + formatLocalizedCompactDurationFromSeconds(value, effectiveLanguage)}><span style={{ height: Math.max(2, value / max * 100) + "%" }} className={index + hours.start === peakHour && value > 0 ? "is-peak" : undefined} /><small>{(index + hours.start) % 2 === 0 ? hourAxisLabel(index + hours.start, effectiveLanguage) : ""}</small></div>)}
      </div>
      <p>{max > 1 ? t("team.member.rhythmPeak", { hour: hourAxisLabel(peakHour, effectiveLanguage) }) : t("team.focus.noFocusYet")}</p>
    </TeamCard>
  );
}
