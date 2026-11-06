import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { formatLocalizedCompactDurationFromSeconds, formatLocalizedDateRangeLabel, localeForDisplayLanguage, parseLocalIsoDay } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import { useLocalization } from "../localization/LocalizationContext";
import { ProjectSparkline } from "../projects/ProjectSparkline";
import { TeamMemberProjectDetail, TEAM_MEMBER_PROJECT_DETAIL_ID } from "./TeamMemberProjectDetail";
import { listWindowDays, type TeamMemberDayRow, type TeamMemberDetailModel, type TeamProjectShare, type TeamWindow } from "./teamFocusModel";
import { TeamProjectRankPanel, displayRoleLabel, type TeamProjectPanelVariant } from "./TeamMembersSections";
import { TeamMemberCalendar } from "./TeamMemberCalendar";
import { TeamMemberWorkspaceView } from "./TeamMemberWorkspaceView";
import type { TeamMemberPageLayout, TeamMemberHistoryPosition } from "./teamPreviewScenarios";
import type { TeamProject } from "./teamTypes";
import {
  TEAM_UNASSIGNED_COLOR,
  TeamAvatar,
  TeamCard,
  TeamMixBar,
  TeamPrivacyNote,
  TeamTrendChart,
  dayNumberLabel,
  firstName,
  hourAxisLabel,
  isWeekend,
  weekdayShortLabel,
  type TeamTrendDay,
} from "./TeamFocusParts";

export type TeamMemberDetailViewProps = {
  readonly teamName: string;
  readonly model: TeamMemberDetailModel;
  readonly projects: readonly TeamProject[];
  readonly window: TeamWindow;
  readonly nowMinuteOfDay: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onBack: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  /** The workspace's date controls, attached to this page while a member is open. */
  readonly rangeControls?: ReactNode;
  readonly contextLabel?: string | null;
  /** The right-hand "what they worked on" card, the same choice as the Overview's. */
  readonly projectPanel?: TeamProjectPanelVariant;
  /** Which composition the page uses while the owner compares them (Dev preview). */
  readonly layout?: TeamMemberPageLayout;
  readonly historyPosition?: TeamMemberHistoryPosition;
  /**
   * The single-scope beta's footnote naming what stays private. Teams with
   * per-item sharing keep no footnote (owner decision 2026-10-18).
   */
  readonly privacyNoteShown?: boolean;
  /**
   * A member's own page inside their Overview or its own tab: this head (null
   * for none) replaces the way back, the steps between people and the name.
   */
  readonly head?: ReactNode;
  /** The person's work titles by day, where their team shares work titles. */
  readonly workTitles?: ReactNode;
};

type PeriodUnit = "days" | "weeks" | "months";

const CAL_START_HOUR = 8;
const CAL_END_HOUR = 20;
const LANE_TICKS = [9, 11, 13, 15, 17, 19];

const LAST_KEYS = { days: "team.focus.lastDays", weeks: "team.focus.lastWeeks", months: "team.focus.lastMonths" } as const;
const MIX_LAST_KEYS = { days: "team.focus.mixLast.days", weeks: "team.focus.mixLast.weeks", months: "team.focus.mixLast.months" } as const;
const CURRENT_KEYS = { days: "team.focus.currentPeriod.days", weeks: "team.focus.currentPeriod.weeks", months: "team.focus.currentPeriod.months" } as const;
const SHIFT_CAPTION_KEYS = { days: "team.focus.shiftsCaption.days", weeks: "team.focus.shiftsCaption.weeks", months: "team.focus.shiftsCaption.months" } as const;
const SHIFT_KEYS = { more: "team.focus.shift.more", less: "team.focus.shift.less", new: "team.focus.shift.new", stopped: "team.focus.shift.stopped", steady: "team.focus.shift.steady" } as const;

function clock(minute: number): string {
  return String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
}

function periodUnit(window: TeamWindow): PeriodUnit {
  const span = listWindowDays(window).length;
  return span <= 1 ? "days" : span <= 7 ? "weeks" : "months";
}

function shortDateLabel(day: string, language: DisplayLanguage): string {
  const parsed = parseLocalIsoDay(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { month: "short", day: "numeric" }).format(parsed);
}

const unassignedShare = (seconds: number): TeamProjectShare => ({ projectId: null, name: null, color: null, seconds });
const colorOf = (share: TeamProjectShare): string => share.color ?? TEAM_UNASSIGNED_COLOR;
const secondsOn = (shares: readonly TeamProjectShare[], projectId: string | null): number => shares.find((share) => share.projectId === projectId)?.seconds ?? 0;
const sumSeconds = (shares: readonly TeamProjectShare[]): number => shares.reduce((total, share) => total + share.seconds, 0);

/** Shares in a fixed order (biggest project first, unassigned last), so every bar stacks the same way. */
function inOrder(shares: readonly TeamProjectShare[], order: readonly TeamProjectShare[]): TeamProjectShare[] {
  const rank = new Map(order.map((share, index) => [share.projectId, index]));
  return [...shares].filter((share) => share.seconds > 0).sort((left, right) => (rank.get(left.projectId) ?? 99) - (rank.get(right.projectId) ?? 99));
}

/** The days a person's page lays out: every expected day so far, plus any other day with time. */
function shownDays(model: TeamMemberDetailModel): readonly TeamMemberDayRow[] {
  return model.dayRows.filter((row) => !row.isFuture && (row.expected || row.focusSeconds > 0 || row.shares.length > 0 || (row.blocks?.length ?? 0) > 0));
}

/**
 * One person's shared window. The head is who they are, never a number: a
 * person's page is about what they worked on, and the figures sit inside the
 * cards where they explain that. The complete screen is the review default;
 * twelve smaller compositions remain in Dev for comparison: A shows the Overview's grammar for one person, B their
 * week as blocks, C a ledger of their projects, D how their mix moves over
 * weeks. Nothing here charts hours of the day beyond the focus_blocks views.
 */
export function TeamMemberDetailView({
  teamName,
  model,
  projects,
  window: timeWindow,
  nowMinuteOfDay,
  hasPrevious,
  hasNext,
  onBack,
  onPrevious,
  onNext,
  rangeControls,
  contextLabel,
  projectPanel = "donut",
  layout = "complete",
  historyPosition = "below",
  privacyNoteShown = true,
  head,
  workTitles = null,
}: TeamMemberDetailViewProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const { member } = model;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Focus the person without scrolling the persistent team header away.
    // The workspace owns scrolling on member navigation; dates keep their focus.
    headingRef.current?.focus({ preventScroll: true });
  }, [member.member_key]);
  const name = firstName(member.display_name);
  const rangeLabel = formatLocalizedDateRangeLabel(timeWindow.start_date, timeWindow.end_date, effectiveLanguage);
  const memberFocus = model.focusVisible;
  const unit = periodUnit(timeWindow);
  const workedOnTitle = t("team.member.projectAllocation");
  const projectSelectionKey = member.member_key + ":" + timeWindow.start_date + ":" + timeWindow.end_date;
  const [projectSelection, setProjectSelection] = useState<{ context: string; projectId: string | null } | null>(null);
  const projectTriggerRef = useRef<HTMLElement | null>(null);
  const selectedProject = projectSelection?.context === projectSelectionKey
    ? model.projects.find((share) => share.projectId === projectSelection.projectId) ?? null : null;
  useEffect(() => {
    if (projectSelection && !selectedProject) {
      setProjectSelection(null);
      projectTriggerRef.current = null;
    }
  }, [projectSelection, selectedProject]);
  const selectProject = (projectId: string | null) => {
    projectTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setProjectSelection(selectedProject?.projectId === projectId ? null : { context: projectSelectionKey, projectId });
  };
  const closeProject = () => {
    setProjectSelection(null);
    projectTriggerRef.current?.focus({ preventScroll: true });
  };
  const pastRows = model.dayRows.filter((row) => !row.isFuture);
  const trackedExpected = pastRows.filter((row) => row.expected);
  const tracked = trackedExpected.filter((row) => row.tracked).length;
  const sparse = memberFocus && trackedExpected.length >= 3 && tracked < trackedExpected.length - 1;

  // The head: who, in what role, over which window, and mostly on what. No figure.
  const subline = [
    displayRoleLabel(member.role_label, t),
    rangeControls ? null : rangeLabel,
    model.mainProject?.projectId ? t("team.focus.sub.mostly", { project: model.mainProject.name ?? "" }) : null,
    sparse ? t("team.focus.trackedDays", { tracked, expected: trackedExpected.length }) : null,
  ].filter(Boolean).join(" · ");

  // Time per day, stacked by project. Focus beyond the day's project rows counts as unassigned.
  const trendDays: TeamTrendDay[] = pastRows.map((row) => {
    const remainder = memberFocus ? row.focusSeconds - sumSeconds(row.shares) : 0;
    return { day: row.day, shares: remainder > 60 ? [...row.shares, unassignedShare(remainder)] : row.shares };
  });
  const withUnassigned = (order: readonly TeamProjectShare[], used: boolean) => (used && !order.some((share) => share.projectId === null) ? [...order, unassignedShare(0)] : order);
  const trendOrder = withUnassigned(model.projects, trendDays.some((entry) => entry.shares.some((share) => share.projectId === null)));
  const hasTrend = trendDays.some((entry) => entry.shares.some((share) => share.seconds > 0));
  const dayChartTitle = memberFocus ? t("team.focus.memberByDay") : t("team.focus.projectByDay");
  const dayChart = (
    <TeamCard id="team-member-days-heading" title={dayChartTitle} className="team-card--chart">
      {hasTrend ? (
        <TeamTrendChart days={trendDays} order={trendOrder} language={effectiveLanguage} ariaLabel={t("team.focus.memberDaysAria", { name: member.display_name })} unassignedLabel={t("team.focus.unassigned")} />
      ) : <div className="team-empty">{t("team.focus.noFocusYet")}</div>}
    </TeamCard>
  );
  const workedOn = <TeamProjectRankPanel id="team-member-rank-heading" title={workedOnTitle} shares={model.projects} language={effectiveLanguage} variant={projectPanel} selectedProjectId={layout === "complete" ? selectedProject?.projectId : undefined} onProjectSelect={layout === "complete" ? selectProject : undefined} projectDetailsId={TEAM_MEMBER_PROJECT_DETAIL_ID} />;
  const windowsOrder = projectOrderAcross(model.lastWindows.map((point) => point.shares));
  const windowsChart = (
    <TeamCard id="team-member-windows-heading" title={t(LAST_KEYS[unit], { count: model.lastWindows.length })} className="team-card--chart team-member-history">
      <TeamTrendChart days={model.lastWindows.map((point) => ({ day: point.startDay, shares: point.shares }))} order={windowsOrder} language={effectiveLanguage} ariaLabel={t("team.focus.lastWindowsAria", { name: member.display_name })} unassignedLabel={t("team.focus.unassigned")} />
    </TeamCard>
  );
  const calendar = <TeamMemberCalendar key={member.member_key + timeWindow.start_date + timeWindow.end_date} model={model} projects={projects} nowMinuteOfDay={nowMinuteOfDay} />;
  const note = model.blocksVisible ? t("team.focus.blocksNote", { name }) : memberFocus ? t("team.focus.daysNote", { name }) : t("team.focus.projectsNote", { name });

  let body: JSX.Element;
  switch (layout) {
    case "complete":
      body = <TeamMemberWorkspaceView model={model} projects={projects} window={timeWindow} nowMinuteOfDay={nowMinuteOfDay} dayChart={dayChart} projectPanel={workedOn} projectDetail={selectedProject ? <TeamMemberProjectDetail key={projectSelectionKey + ":" + selectedProject.projectId} model={model} project={selectedProject} window={timeWindow} onClose={closeProject} /> : null} history={windowsChart} historyPosition={historyPosition} />;
      break;
    case "mirror-stack":
      body = <div className="team-member-stack">{dayChart}<MemberMixCard title={workedOnTitle} shares={model.projects} withTime wide /></div>;
      break;
    case "mirror-mix":
      body = (
        <div className="team-focus__panels">
          <MemberMixColumns days={trendDays} order={trendOrder} title={t("team.focus.mixByDay")} ariaLabel={t("team.focus.mixByDayAria", { name: member.display_name })} />
          <MemberMixCard title={workedOnTitle} shares={model.projects} withTime={false} />
        </div>
      );
      break;
    case "week":
      body = (
        <div className="team-focus__body">
          <div className="team-focus__main">{model.blocksVisible ? calendar : dayChart}</div>
          <aside className="team-rail" aria-label={t("team.focus.railAria")}>{workedOn}</aside>
        </div>
      );
      break;
    case "week-wide":
      body = model.blocksVisible ? (
        <div className="team-member-stack">
          <MemberLegendRow title={workedOnTitle} shares={model.projects} />
          {calendar}
        </div>
      ) : <div className="team-member-stack">{dayChart}<MemberMixCard title={workedOnTitle} shares={model.projects} withTime wide /></div>;
      break;
    case "week-lanes":
      body = (
        <div className="team-focus__panels">
          {model.blocksVisible ? <MemberLanes model={model} projects={projects} nowMinuteOfDay={nowMinuteOfDay} /> : dayChart}
          {workedOn}
        </div>
      );
      break;
    case "ledger":
      body = <MemberLedger model={model} title={workedOnTitle} />;
      break;
    case "ledger-sheet":
      body = <MemberTimesheet model={model} title={workedOnTitle} />;
      break;
    case "ledger-days":
      body = <MemberDaysLedger model={model} title={workedOnTitle} />;
      break;
    case "trend":
      body = <div className="team-focus__panels">{windowsChart}{workedOn}</div>;
      break;
    case "trend-mix":
      body = <div className="team-focus__panels"><MemberMixRows model={model} unit={unit} order={windowsOrder} />{workedOn}</div>;
      break;
    case "trend-shifts":
      body = <div className="team-focus__panels">{windowsChart}<MemberShifts model={model} unit={unit} /></div>;
      break;
    default:
      body = <div className="team-focus__panels">{dayChart}{workedOn}</div>;
  }

  return (
    <section className={"team-focus team-member-detail team-member-detail--" + layout + (head !== undefined ? " team-member-detail--self" : "")} aria-label={t("team.focus.memberDetailAria", { name: member.display_name })}>
      {head !== undefined ? head : (
      <header className="team-focus__head team-member-detail__head">
        <div className="team-member-detail__topline">
          <div className="team-member-detail__location">
            <button type="button" className="team-crumbs__link team-member-detail__back" title={teamName} onClick={onBack}>
              <span aria-hidden="true">‹</span> {t("team.member.backOverview")}
            </button>
            {contextLabel ? <span className="team-member-detail__context" title={contextLabel}>{contextLabel}</span> : null}
          </div>
          <nav className="team-member-detail__nav" aria-label={t("team.member.navigation")}>
            <button type="button" className="app-btn app-btn--quiet app-btn--compact team-member-detail__step" aria-label={t("team.focus.previousMember")} disabled={!hasPrevious} onClick={onPrevious}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
              <span>{t("team.focus.previousMember")}</span>
            </button>
            <button type="button" className="app-btn app-btn--quiet app-btn--compact team-member-detail__step" aria-label={t("team.focus.nextMember")} disabled={!hasNext} onClick={onNext}>
              <span>{t("team.focus.nextMember")}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </nav>
        </div>
        <div className="team-member-detail__mainline">
          <div className="team-member-detail__who">
            <TeamAvatar name={member.display_name} size="lg" />
            <div className="team-member-detail__identity">
              <h2 className="team-member-detail__name" ref={headingRef} tabIndex={-1}>
                {member.display_name}
                {model.tracking !== null ? <span className={"team-live team-live--inline" + (model.tracking ? " is-on" : "")} title={model.tracking ? t("team.focus.tracking") : t("team.focus.offline")} /> : null}
              </h2>
              <p className="team-focus__sub">{subline}</p>
            </div>
          </div>
          {rangeControls ? <div className="team-member-detail__range">{rangeControls}</div> : null}
        </div>
      </header>
      )}

      {body}

      {workTitles}

      {privacyNoteShown ? <TeamPrivacyNote>{note}</TeamPrivacyNote> : null}
    </section>
  );
}

/** Projects across several windows, biggest overall first and unassigned last. */
function projectOrderAcross(windows: readonly (readonly TeamProjectShare[])[]): TeamProjectShare[] {
  const totals = new Map<string | null, TeamProjectShare>();
  for (const shares of windows) {
    for (const share of shares) {
      const entry = totals.get(share.projectId);
      totals.set(share.projectId, entry ? { ...entry, seconds: entry.seconds + share.seconds } : share);
    }
  }
  return [...totals.values()].sort((left, right) => (left.projectId === null ? 1 : right.projectId === null ? -1 : right.seconds - left.seconds));
}

/* ── Shared pieces: the Breakdown's category stack and the share dial's legend ── */

function MixBar({ shares, label }: { readonly shares: readonly TeamProjectShare[]; readonly label?: string }): JSX.Element {
  return <TeamMixBar shares={shares} label={label} />;
}

function MixLegend({ shares, withTime, className }: { readonly shares: readonly TeamProjectShare[]; readonly withTime: boolean; readonly className?: string }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const total = sumSeconds(shares);
  return (
    <ul className={"projects-share__legend team-mix-legend" + (withTime ? "" : " team-mix-legend--share") + (className ? " " + className : "")}>
      {shares.map((share) => (
        <li key={share.projectId ?? "unassigned"}>
          <span className="projects-share__swatch" style={{ background: colorOf(share) }} />
          <span className="projects-share__label">{share.name ?? t("team.focus.unassigned")}</span>
          {withTime ? <span className="projects-share__time">{formatLocalizedCompactDurationFromSeconds(share.seconds, effectiveLanguage)}</span> : null}
          <span className="projects-share__pct">{total > 0 ? Math.round((share.seconds / total) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  );
}

/* A2 / A3 — where the window went as one stacked bar over the dial's legend (A3: shares only, no hours). */
function MemberMixCard({ title, shares, withTime, wide = false }: { readonly title: string; readonly shares: readonly TeamProjectShare[]; readonly withTime: boolean; readonly wide?: boolean }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const total = sumSeconds(shares);
  return (
    <TeamCard id="team-member-mix-heading" title={title} total={withTime && total > 0 ? formatLocalizedCompactDurationFromSeconds(total, effectiveLanguage) : null} className={"team-card--mix" + (wide ? " team-card--mix-wide" : "")}>
      {total <= 0 ? <div className="team-empty">{t("team.focus.noProjectTime")}</div> : (
        <div className="team-mix">
          <MixBar shares={shares} />
          <MixLegend shares={shares} withTime={withTime} />
        </div>
      )}
    </TeamCard>
  );
}

/* A3 — each day's split by project as a share of that day: no hour axis, no day totals. */
function MemberMixColumns({ days, order, title, ariaLabel }: { readonly days: readonly TeamTrendDay[]; readonly order: readonly TeamProjectShare[]; readonly title: string; readonly ariaLabel: string }): JSX.Element {
  const { effectiveLanguage } = useLocalization();
  const dense = days.length > 7;
  return (
    <TeamCard id="team-member-mixcols-heading" title={title} className="team-card--chart">
      <div className={"team-mixcols" + (dense ? " is-dense" : "")} role="img" aria-label={ariaLabel}>
        {days.map((entry) => {
          const ordered = inOrder(entry.shares, order);
          const total = sumSeconds(ordered);
          return (
            <div key={entry.day} className={"team-mixcols__col" + (total <= 0 ? " is-empty" : "")}>
              <span className="team-mixcols__bar">
                {ordered.map((share) => <span key={share.projectId ?? "unassigned"} className="team-mixcols__seg" style={{ height: (share.seconds / total) * 100 + "%", background: colorOf(share) }} />)}
              </span>
              <span className="team-mixcols__label">{dense ? dayNumberLabel(entry.day, effectiveLanguage) : weekdayShortLabel(entry.day, effectiveLanguage)}</span>
            </div>
          );
        })}
      </div>
    </TeamCard>
  );
}

/* B2 — the window's projects in one row above a full-width calendar. */
function MemberLegendRow({ title, shares }: { readonly title: string; readonly shares: readonly TeamProjectShare[] }): JSX.Element {
  return (
    <div className="team-legend-row" aria-label={title}>
      <span className="label-mono team-legend-row__title">{title}</span>
      <MixLegend shares={shares} withTime className="team-mix-legend--row" />
    </div>
  );
}

/* B3 — the same blocks as a row per day across the hours: compact enough to sit beside the projects card. */
function MemberLanes({ model, projects, nowMinuteOfDay }: { readonly model: TeamMemberDetailModel; readonly projects: readonly TeamProject[]; readonly nowMinuteOfDay: number }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const projectColor = (projectId: string | null): string => (projectId ? projects.find((project) => project.id === projectId)?.color ?? TEAM_UNASSIGNED_COLOR : TEAM_UNASSIGNED_COLOR);
  const projectName = (projectId: string | null): string => (projectId ? projects.find((project) => project.id === projectId)?.name ?? t("team.dashboard.projectFallback") : t("team.focus.unassigned"));
  const days = shownDays(model);
  const span = (CAL_END_HOUR - CAL_START_HOUR) * 60;
  const toPct = (minute: number) => Math.max(0, Math.min(100, ((minute - CAL_START_HOUR * 60) / span) * 100));
  const nowInRange = nowMinuteOfDay >= CAL_START_HOUR * 60 && nowMinuteOfDay <= CAL_END_HOUR * 60;
  return (
    <TeamCard id="team-member-lanes-heading" title={t("team.focus.blocksByDay")} className="team-card--lanes">
      <div className="team-lanes" role="img" aria-label={t("team.focus.lanesAria", { name: model.member.display_name })}>
        {days.map((row) => (
          <div key={row.day} className={"team-lanes__row" + (row.isToday ? " is-today" : "") + (isWeekend(row.day) ? " is-weekend" : "")}>
            <span className="team-lanes__day"><strong>{weekdayShortLabel(row.day, effectiveLanguage)}</strong><small>{dayNumberLabel(row.day, effectiveLanguage)}</small></span>
            <span className="team-lanes__track">
              {LANE_TICKS.map((hour) => <span key={hour} className="team-lanes__line" style={{ left: toPct(hour * 60) + "%" }} aria-hidden="true" />)}
              {(row.blocks ?? []).map((block, index) => {
                const start = Math.max(CAL_START_HOUR * 60, block.start_minute);
                const end = Math.min(CAL_END_HOUR * 60, block.end_minute);
                if (end <= start) return null;
                return <span key={index} className="team-lanes__block" style={{ left: toPct(start) + "%", width: Math.max(0.6, toPct(end) - toPct(start)) + "%", background: projectColor(block.project_id) }} title={projectName(block.project_id) + " · " + clock(block.start_minute) + "–" + clock(block.end_minute)} />;
              })}
              {row.isToday && nowInRange ? <span className="team-lanes__now" style={{ left: toPct(nowMinuteOfDay) + "%" }} aria-hidden="true" /> : null}
            </span>
          </div>
        ))}
        <div className="team-lanes__axis" aria-hidden="true">
          <span />
          <span className="team-lanes__ticks">{LANE_TICKS.map((hour) => <span key={hour} style={{ left: toPct(hour * 60) + "%" }}>{hourAxisLabel(hour, effectiveLanguage)}</span>)}</span>
        </div>
      </div>
    </TeamCard>
  );
}

function LedgerHead({ title, count }: { readonly title: string; readonly count: number }): JSX.Element {
  return (
    <div className="team-focus__tools">
      <h3 className="team-focus__section-title label-mono"><span>{title}</span><span className="team-focus__count">· {count}</span></h3>
    </div>
  );
}

/* C1 — the personal Projects table, one row per project: its days as a sparkline, its time, its change. */
function MemberLedger({ model, title }: { readonly model: TeamMemberDetailModel; readonly title: string }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const pastRows = model.dayRows.filter((row) => !row.isFuture);
  const total = sumSeconds(model.projects);
  const changeLabel = (share: TeamProjectShare): { readonly text: string; readonly tone: "up" | "down" | "flat" | "new" } => {
    const previous = secondsOn(model.previousProjects, share.projectId);
    if (previous <= 0) return { text: t("team.focus.change.new"), tone: "new" };
    const delta = share.seconds - previous;
    if (Math.abs(delta) < 15 * 60) return { text: t("team.focus.change.same"), tone: "flat" };
    return { text: (delta > 0 ? "+" : "−") + duration(Math.abs(delta)), tone: delta > 0 ? "up" : "down" };
  };
  return (
    <div className="team-focus__people">
      <LedgerHead title={title} count={model.projects.length} />
      <div className="projects-table team-ledger" role="region" aria-label={title}>
        <div className="projects-table__head team-ledger__cols">
          <span>{t("team.projects.headerProject")}</span>
          <span>{t("team.focus.col.byDay")}</span>
          <span>{t("team.focus.col.time")}</span>
          <span>{t("team.focus.col.change")}</span>
        </div>
        {model.projects.map((share) => {
          const color = colorOf(share);
          const change = changeLabel(share);
          return (
            <div className="projects-table__rowwrap" key={share.projectId ?? "unassigned"}>
              <div className={"projects-table__row team-ledger__cols" + (share.projectId === null ? " is-unassigned" : "")}>
                <span className="pt-proj"><span className="pt-swatch" style={{ background: color }} /><strong>{share.name ?? t("team.focus.unassigned")}</strong></span>
                <span className="pt-trend"><ProjectSparkline values={pastRows.map((row) => secondsOn(row.shares, share.projectId))} color={color} label={t("team.focus.ledgerTrendAria", { project: share.name ?? t("team.focus.unassigned") })} /></span>
                <span className="pt-total"><b>{duration(share.seconds)}</b><small>{total > 0 ? Math.round((share.seconds / total) * 100) : 0}%</small></span>
                <span className={"team-ledger__change is-" + change.tone}>{change.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* C2 — a timesheet: hours per project per day (per week across a month), tinted by size, with day totals. */
function MemberTimesheet({ model, title }: { readonly model: TeamMemberDetailModel; readonly title: string }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const days = shownDays(model);
  const pastRows = model.dayRows.filter((row) => !row.isFuture);
  const buckets = days.length <= 7
    ? days.map((row) => ({ key: row.day, label: weekdayShortLabel(row.day, effectiveLanguage) + " " + dayNumberLabel(row.day, effectiveLanguage), rows: [row], isToday: row.isToday }))
    : Array.from({ length: Math.ceil(pastRows.length / 7) }, (_, index) => {
        const rows = pastRows.slice(index * 7, index * 7 + 7);
        return { key: rows[0]!.day, label: shortDateLabel(rows[0]!.day, effectiveLanguage), rows, isToday: rows.some((row) => row.isToday) };
      });
  const cell = (share: TeamProjectShare, rows: readonly TeamMemberDayRow[]) => rows.reduce((total, row) => total + secondsOn(row.shares, share.projectId), 0);
  const max = Math.max(1, ...model.projects.flatMap((share) => buckets.map((bucket) => cell(share, bucket.rows))));
  const grand = sumSeconds(model.projects);
  return (
    <div className="team-focus__people">
      <LedgerHead title={title} count={model.projects.length} />
      <div className="projects-table team-sheet" role="region" aria-label={title} style={{ "--team-sheet-cols": buckets.length } as CSSProperties}>
        <div className="projects-table__head team-sheet__cols">
          <span>{t("team.projects.headerProject")}</span>
          {buckets.map((bucket) => <span key={bucket.key} className={bucket.isToday ? "is-today" : undefined}>{bucket.label}</span>)}
          <span>{t("team.focus.col.total")}</span>
        </div>
        {model.projects.map((share) => (
          <div className="projects-table__rowwrap" key={share.projectId ?? "unassigned"}>
            <div className={"projects-table__row team-sheet__cols" + (share.projectId === null ? " is-unassigned" : "")}>
              <span className="pt-proj"><span className="pt-swatch" style={{ background: colorOf(share) }} /><strong>{share.name ?? t("team.focus.unassigned")}</strong></span>
              {buckets.map((bucket) => {
                const seconds = cell(share, bucket.rows);
                return (
                  <span key={bucket.key} className={"team-sheet__cell" + (seconds <= 0 ? " is-empty" : "")} style={seconds > 0 ? { background: "color-mix(in srgb, " + colorOf(share) + " " + Math.round(8 + (seconds / max) * 30) + "%, transparent)" } : undefined}>
                    {seconds > 0 ? duration(seconds) : "–"}
                  </span>
                );
              })}
              <span className="pt-total"><b>{duration(share.seconds)}</b></span>
            </div>
          </div>
        ))}
        <div className="projects-table__rowwrap team-sheet__totals">
          <div className="projects-table__row team-sheet__cols">
            <span className="pt-proj"><strong>{t("team.focus.col.total")}</strong></span>
            {buckets.map((bucket) => {
              const seconds = model.projects.reduce((total, share) => total + cell(share, bucket.rows), 0);
              return <span key={bucket.key} className={"team-sheet__cell" + (seconds <= 0 ? " is-empty" : "")}>{seconds > 0 ? duration(seconds) : "–"}</span>;
            })}
            <span className="pt-total"><b>{duration(grand)}</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* C3 — which days each project was touched, and its share: no hours per day. */
function MemberDaysLedger({ model, title }: { readonly model: TeamMemberDetailModel; readonly title: string }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const days = shownDays(model);
  const total = sumSeconds(model.projects);
  const max = Math.max(1, ...model.projects.map((share) => share.seconds));
  return (
    <div className="team-focus__people">
      <LedgerHead title={title} count={model.projects.length} />
      <div className="projects-table team-ledger team-ledger--days" role="region" aria-label={title}>
        <div className="projects-table__head team-ledger__cols">
          <span>{t("team.projects.headerProject")}</span>
          <span>{t("team.focus.col.days")}</span>
          <span>{t("team.focus.col.share")}</span>
          <span>{t("team.focus.col.time")}</span>
        </div>
        {model.projects.map((share) => {
          const color = colorOf(share);
          const touched = days.map((row) => secondsOn(row.shares, share.projectId) > 0);
          const count = touched.filter(Boolean).length;
          const pct = total > 0 ? Math.round((share.seconds / total) * 100) : 0;
          return (
            <div className="projects-table__rowwrap" key={share.projectId ?? "unassigned"}>
              <div className={"projects-table__row team-ledger__cols" + (share.projectId === null ? " is-unassigned" : "")}>
                <span className="pt-proj"><span className="pt-swatch" style={{ background: color }} /><strong>{share.name ?? t("team.focus.unassigned")}</strong></span>
                <span className="team-daydots" title={t("team.focus.daysOnProject", { count, total: days.length })}>
                  <span className={"team-daydots__dots" + (days.length > 7 ? " is-dense" : "")}>
                    {days.map((row, index) => <span key={row.day} className={"team-daydots__dot" + (touched[index] ? " is-on" : "")} style={touched[index] ? { background: color } : undefined} />)}
                  </span>
                  <small>{t("team.focus.daysOnProject", { count, total: days.length })}</small>
                </span>
                <span className="team-ledger__share" style={{ "--trend-tone": color } as CSSProperties}>
                  <span className="drift-source-bar"><span className="drift-source-bar__fill" style={{ width: Math.max(3, (share.seconds / max) * 100) + "%" }} /></span>
                  <small>{pct}%</small>
                </span>
                <span className="pt-total"><b>{duration(share.seconds)}</b></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* D2 — the project mix of each recent window as a share bar, newest on top: no hours. */
function MemberMixRows({ model, unit, order }: { readonly model: TeamMemberDetailModel; readonly unit: PeriodUnit; readonly order: readonly TeamProjectShare[] }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const rows = [...model.lastWindows].reverse();
  return (
    <TeamCard id="team-member-mixrows-heading" title={t(MIX_LAST_KEYS[unit], { count: rows.length })} className="team-card--mixrows">
      <div className="team-mixrows" role="img" aria-label={t("team.focus.lastWindowsAria", { name: model.member.display_name })}>
        {rows.map((point) => (
          <div key={point.startDay} className={"team-mixrows__row" + (point.isCurrent ? " is-current" : "")}>
            <span className="team-mixrows__label">{point.isCurrent ? t(CURRENT_KEYS[unit]) : shortDateLabel(point.startDay, effectiveLanguage)}</span>
            <MixBar shares={inOrder(point.shares, order)} />
          </div>
        ))}
      </div>
    </TeamCard>
  );
}

type Shift = { readonly share: TeamProjectShare; readonly kind: keyof typeof SHIFT_KEYS; readonly delta: number };

function shiftsOf(model: TeamMemberDetailModel): { readonly shifts: readonly Shift[]; readonly earlier: number } {
  const current = model.lastWindows[model.lastWindows.length - 1];
  const earlier = model.lastWindows.slice(0, -1);
  if (!current || earlier.length === 0) return { shifts: [], earlier: earlier.length };
  const order = projectOrderAcross(model.lastWindows.map((point) => point.shares));
  const shifts: Shift[] = [];
  for (const share of order) {
    // A shift is about projects; unassigned time is not one.
    if (share.projectId === null) continue;
    const now = secondsOn(current.shares, share.projectId);
    const usual = earlier.reduce((total, point) => total + secondsOn(point.shares, share.projectId), 0) / earlier.length;
    const delta = now - usual;
    let kind: Shift["kind"];
    if (usual <= 0 && now > 0) kind = "new";
    else if (now <= 0 && usual >= 30 * 60) kind = "stopped";
    else if (now <= 0) continue;
    else if (Math.abs(delta) < Math.max(15 * 60, usual * 0.15)) kind = "steady";
    else kind = delta > 0 ? "more" : "less";
    shifts.push({ share: { ...share, seconds: now }, kind, delta });
  }
  shifts.sort((left, right) => (left.kind === "steady" ? 1 : 0) - (right.kind === "steady" ? 1 : 0) || Math.abs(right.delta) - Math.abs(left.delta));
  return { shifts: shifts.slice(0, 6), earlier: earlier.length };
}

/* D3 — what moved against their own usual, in words, the way the Overview words its comparison. */
function MemberShifts({ model, unit }: { readonly model: TeamMemberDetailModel; readonly unit: PeriodUnit }): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const { shifts, earlier } = shiftsOf(model);
  return (
    <TeamCard id="team-member-shifts-heading" title={t("team.focus.shiftsTitle")} aside={earlier > 0 ? <span className="team-shifts__caption">{t(SHIFT_CAPTION_KEYS[unit], { count: earlier })}</span> : null} className="team-card--shifts">
      {shifts.length === 0 ? <div className="team-empty">{t("team.focus.shiftsEmpty")}</div> : (
        <ul className="team-shifts">
          {shifts.map((shift) => (
            <li key={shift.share.projectId ?? "unassigned"} className={"team-shifts__row is-" + shift.kind}>
              <span className="projects-share__swatch" style={{ background: colorOf(shift.share) }} />
              <span className="team-shifts__text">{t(SHIFT_KEYS[shift.kind], { project: shift.share.name ?? t("team.focus.unassigned") })}</span>
              <span className="team-shifts__delta">{shift.kind === "steady" ? "" : (shift.delta > 0 ? "+" : "−") + formatLocalizedCompactDurationFromSeconds(Math.abs(shift.delta), effectiveLanguage)}</span>
            </li>
          ))}
        </ul>
      )}
    </TeamCard>
  );
}

export default TeamMemberDetailView;

