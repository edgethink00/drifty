import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAppUsageSummaries,
  buildFlowBlocks,
  buildProductivityDurations,
} from "@drifty/domain";
import driftyMark from "../../../assets/drifty-mark.svg";
import { NavIcon } from "../../../app/AppShell";
import type { NavIconType } from "../../../app/navigation";
import { YourDayUsageSummary } from "../../dashboard/YourDayUsageSummary";
import { YourDayCardLane, YourDayLaneTitle } from "../../dashboard/YourDayCardLane";
import { BreakdownSidePanel } from "../../dashboard/BreakdownSidePanelChrome";
import { CompactRingChart } from "../../dashboard/CompactRingChart";
import { buildProductivityCenterPercent, buildProductivityRingEntries } from "../../dashboard/FlowCompactSplitChart";
import { ShareIcon } from "../../dashboard/DashboardPage";
import { DashboardPageHeader } from "../../dashboard/DashboardPageHeader";
import { TIMELINE_ZOOM_DEFAULT } from "../../dashboard/timelineZoom";
import { FlowChartView } from "../../flow-chart/FlowChartView";
import { YOUR_DAY_FLOW_INTERVAL_MINUTES } from "../../flow-chart/flowChartDetailPreference";
import { useLocalization } from "../../localization/LocalizationContext";
import { formatLocalizedCompactDurationFromSeconds, logicalTodayIsoDate } from "../../../lib/formatting";
import { prefersReducedMotion } from "../firstDayPrepMotion";
import {
  ENTRY_DEMO_CLASSIFICATION_OPTIONS,
  ENTRY_DEMO_CLOCK_END_MINUTE,
  ENTRY_DEMO_CLOCK_START_MINUTE,
  ENTRY_DEMO_START_OF_DAY_MINUTES,
  buildEntryDemoSegments,
  entryDemoClockMinute,
  revealEntryDemoSegments,
} from "../entryDemoDay";

/** One pass of the sample day, the pause on the finished day, and the fade before the next pass.
 *  The pass ran in 12 s at first; the owner asked for about 0.65x of that so the day fills
 *  slowly enough to follow (2026-10-08). */
export const ENTRY_DEMO_RUN_MS = 18_500;
export const ENTRY_DEMO_HOLD_MS = 3_400;
export const ENTRY_DEMO_FADE_MS = 420;
/** After this many passes the finished day stays on screen, so a window left open sits still. */
export const ENTRY_DEMO_MAX_RUNS = 3;

const NO_APP_ICONS: Record<string, string | null> = {};
const NOOP = () => {};
const NO_PROJECTS: ReadonlyMap<string, string | null> = new Map();

type DemoClock = { readonly minute: number; readonly fading: boolean };

/**
 * Drives the sample day's clock with requestAnimationFrame, committing only when the visible
 * minute changes (one flow-chart cell). It pauses while the document is hidden and resumes
 * where it left off.
 */
function useEntryDemoClock(animate: boolean): DemoClock {
  const [clock, setClock] = useState<DemoClock>(() => ({
    minute: animate ? ENTRY_DEMO_CLOCK_START_MINUTE : ENTRY_DEMO_CLOCK_END_MINUTE,
    fading: false,
  }));

  useEffect(() => {
    if (!animate || typeof requestAnimationFrame !== "function") return undefined;
    let frame = 0;
    let runs = 0;
    let runStartedAt = performance.now();
    let hiddenAt: number | null = null;
    const commit = (next: DemoClock) => {
      setClock((current) => (current.minute === next.minute && current.fading === next.fading ? current : next));
    };
    const tick = (now: number) => {
      const elapsed = now - runStartedAt;
      if (elapsed < ENTRY_DEMO_RUN_MS) {
        commit({ minute: entryDemoClockMinute(elapsed, ENTRY_DEMO_RUN_MS), fading: false });
      } else if (elapsed < ENTRY_DEMO_RUN_MS + ENTRY_DEMO_HOLD_MS) {
        commit({ minute: ENTRY_DEMO_CLOCK_END_MINUTE, fading: false });
      } else if (runs + 1 >= ENTRY_DEMO_MAX_RUNS) {
        commit({ minute: ENTRY_DEMO_CLOCK_END_MINUTE, fading: false });
        return;
      } else if (elapsed < ENTRY_DEMO_RUN_MS + ENTRY_DEMO_HOLD_MS + ENTRY_DEMO_FADE_MS) {
        commit({ minute: ENTRY_DEMO_CLOCK_END_MINUTE, fading: true });
      } else {
        runs += 1;
        runStartedAt = now;
        commit({ minute: ENTRY_DEMO_CLOCK_START_MINUTE, fading: false });
      }
      frame = requestAnimationFrame(tick);
    };
    const handleVisibility = () => {
      if (document.hidden) {
        if (hiddenAt !== null) return;
        hiddenAt = performance.now();
        cancelAnimationFrame(frame);
        return;
      }
      if (hiddenAt === null) return;
      runStartedAt += performance.now() - hiddenAt;
      hiddenAt = null;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [animate]);

  return clock;
}

const RAIL_ITEMS: readonly { readonly icon: NavIconType; readonly top: number }[] = [
  { icon: "calendar", top: 91 },
  { icon: "classification", top: 159 },
  { icon: "projects", top: 191 },
  { icon: "trends", top: 223 },
  { icon: "history", top: 255 },
  { icon: "leaderboard", top: 322 },
];

/**
 * The first onboarding screen's product picture: a Drifty window at its real 1000x720 compact
 * size with the sidebar collapsed, showing Today while a synthetic workday is recorded. The
 * header, hours-down chart, activity lane and Breakdown are the dashboard's own components fed
 * through its own aggregation, so the picture follows the real product, theme and language.
 * It is decorative: hidden from assistive technology and inert to pointer and keyboard.
 */
export function EntryDayDemo() {
  const { effectiveLanguage, t } = useLocalization();
  const rootRef = useRef<HTMLDivElement>(null);
  const [animate] = useState(() => !prefersReducedMotion());
  const clock = useEntryDemoClock(animate);
  const day = useMemo(() => logicalTodayIsoDate(ENTRY_DEMO_START_OF_DAY_MINUTES), []);
  const segments = useMemo(() => buildEntryDemoSegments(day), [day]);
  const recorded = useMemo(() => revealEntryDemoSegments(segments, day, clock.minute), [clock.minute, day, segments]);
  const flowBlocks = useMemo(
    () => buildFlowBlocks(recorded, day, YOUR_DAY_FLOW_INTERVAL_MINUTES, ENTRY_DEMO_CLASSIFICATION_OPTIONS, ENTRY_DEMO_START_OF_DAY_MINUTES),
    [day, recorded],
  );
  const productivity = useMemo(() => buildProductivityDurations(recorded, ENTRY_DEMO_CLASSIFICATION_OPTIONS), [recorded]);
  const focusSeconds = productivity.find(entry => entry.productivity === "focus")?.totalSeconds ?? 0;
  const appUsage = useMemo(() => buildAppUsageSummaries(recorded, { limit: 6 }), [recorded]);
  const recordedSeconds = useMemo(() => recorded.reduce((sum, segment) => sum + segment.durationSeconds, 0), [recorded]);
  const focusDuration = focusSeconds > 0
    ? formatLocalizedCompactDurationFromSeconds(focusSeconds, effectiveLanguage)
    : effectiveLanguage === "en" ? "0m" : formatLocalizedCompactDurationFromSeconds(0, effectiveLanguage);

  useEffect(() => {
    rootRef.current?.setAttribute("inert", "");
  }, []);

  return (
    <div ref={rootRef} className="onb-entry-demo" aria-hidden="true" data-animated={animate ? "true" : "false"}>
      <div className="onb-entry-demo__window">
        <div className="onb-entry-demo__chrome">
          <span className="onb-entry-demo__lights"><i /><i /><i /></span>
          <span className="onb-entry-demo__tool onb-entry-demo__tool--sidebar">
            <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M10 5v14" /></svg>
          </span>
          <span className="onb-entry-demo__tool onb-entry-demo__tool--back">
            <svg viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6" /></svg>
          </span>
          <span className="onb-entry-demo__tool onb-entry-demo__tool--forward">
            <svg viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6" /></svg>
          </span>
        </div>
        <div className="onb-entry-demo__rail">
          <img className="onb-entry-demo__mark" src={driftyMark} alt="" />
          <span className="onb-entry-demo__rail-rule" />
          {RAIL_ITEMS.map((item) => (
            <span
              key={item.icon}
              className={"onb-entry-demo__nav" + (item.icon === "home" ? " onb-entry-demo__nav--active" : "")}
              style={{ top: item.top }}
            >
              <NavIcon type={item.icon} />
            </span>
          ))}
        </div>
        <div className="onb-entry-demo__card content--dashboard">
          <div className="page onb-entry-demo__page" data-fading={clock.fading ? "true" : "false"}>
            <div className="week-v2-grid week-v2-grid--calendar week-v2-grid--day week-v2-grid--side-open your-day-rows">
              <div className="day-split__main">
                <DashboardPageHeader
                  dashPeriod="Today"
                  initialDataLoading={false}
                  dateNavigator={null}
                  focusDuration={focusDuration}
                  headerAction={(
                    <span className="app-btn app-btn--secondary app-btn--header-action dashboard-share-button">
                      <ShareIcon />
                      <span className="dashboard-page-head__action-label">{t("dashboard.today.share")}</span>
                    </span>
                  )}
                />
                <div className="flow-breakdown-layout flow-breakdown-layout--full">
                  <div className="flow-breakdown-layout__chart">
                    <FlowChartView
                      blocks={flowBlocks}
                      appIcons={NO_APP_ICONS}
                      currentMinuteOfDay={clock.minute}
                      intervalMinutes={YOUR_DAY_FLOW_INTERVAL_MINUTES}
                      orientation="hoursDown"
                      timeZoom={{ percent: TIMELINE_ZOOM_DEFAULT, onChange: NOOP }}
                      scrollScale={{
                        zoomPercent: TIMELINE_ZOOM_DEFAULT,
                        dayKey: day,
                        initialScrollMinute: 0,
                        initialMinute: 0,
                      }}
                      rowAside={{ header: <YourDayLaneTitle />, overlay: () => <YourDayCardLane
                        day={day} segments={recorded} classificationOptions={ENTRY_DEMO_CLASSIFICATION_OPTIONS}
                        startOfDayMinutes={ENTRY_DEMO_START_OF_DAY_MINUTES} colorMode="productivity"
                        projectBySegmentId={NO_PROJECTS} appIcons={NO_APP_ICONS} onOpenMinute={NOOP}
                      /> }}
                      startOfDayMinutes={ENTRY_DEMO_START_OF_DAY_MINUTES}
                      showEmptyGrid
                      colorMode="productivity"
                      onColorModeChange={NOOP}
                    />
                  </div>
                </div>
              </div>
              <BreakdownSidePanel open onToggle={NOOP} toggleSubject="day breakdown"
                ariaLabel={t("dashboard.today.breakdownAria")} title={t("dashboard.today.breakdown")}
                collapseLabel={t("dashboard.today.collapseBreakdown")}>
                <CompactRingChart title={t("dashboard.today.productivity")}
                  ariaLabel={t("dashboard.today.compactClassificationAria", { title: t("dashboard.today.productivity") })}
                  entries={buildProductivityRingEntries(productivity)} totalSeconds={recordedSeconds}
                  centerPercent={buildProductivityCenterPercent(productivity)} flowBlocks={flowBlocks}
                  appIcons={NO_APP_ICONS} language={effectiveLanguage} />
                <YourDayUsageSummary items={appUsage} totalSeconds={recordedSeconds} appIcons={NO_APP_ICONS} />
              </BreakdownSidePanel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
