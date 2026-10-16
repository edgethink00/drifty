import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAppUsageSummaries,
  buildFlowBlocks,
  buildProductivityDurations,
} from "@drifty/domain";
import driftyMark from "../../../assets/drifty-mark.svg";
import { NavIcon } from "../../../app/AppShell";
import type { NavIconType } from "../../../app/navigation";
import { AppUsagePanel } from "../../dashboard/AppUsagePanel";
import { ShareIcon } from "../../dashboard/DashboardPage";
import { DashboardPageHeader } from "../../dashboard/DashboardPageHeader";
import { FocusDriftSection } from "../../dashboard/FocusDriftSection";
import { applyFocusDriftReplayReveal, buildFocusDriftChart } from "../../dashboard/focusDriftChart";
import { FlowChartView } from "../../flow-chart/FlowChartView";
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
  { icon: "home", top: 123 },
  { icon: "calendar", top: 155 },
  { icon: "classification", top: 223 },
  { icon: "projects", top: 255 },
  { icon: "trends", top: 287 },
  { icon: "history", top: 319 },
  { icon: "leaderboard", top: 386 },
];

/**
 * The first onboarding screen's product picture: a Drifty window at its real 1000x720 compact
 * size with the sidebar collapsed, showing Today while a synthetic workday is recorded. The
 * header, flow chart, focus/drift chart and app list are the dashboard's own components fed
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
  const fullFocusDriftChart = useMemo(
    () => buildFocusDriftChart(segments, day, ENTRY_DEMO_CLASSIFICATION_OPTIONS, null, ENTRY_DEMO_START_OF_DAY_MINUTES, effectiveLanguage),
    [day, effectiveLanguage, segments],
  );
  const recorded = useMemo(() => revealEntryDemoSegments(segments, day, clock.minute), [clock.minute, day, segments]);
  const flowBlocks = useMemo(
    () => buildFlowBlocks(recorded, day, 3, ENTRY_DEMO_CLASSIFICATION_OPTIONS, ENTRY_DEMO_START_OF_DAY_MINUTES),
    [day, recorded],
  );
  const focusSeconds = useMemo(
    () => buildProductivityDurations(recorded, ENTRY_DEMO_CLASSIFICATION_OPTIONS)
      .find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0,
    [recorded],
  );
  const appUsage = useMemo(() => buildAppUsageSummaries(recorded, { limit: 6 }), [recorded]);
  const recordedSeconds = useMemo(() => recorded.reduce((sum, segment) => sum + segment.durationSeconds, 0), [recorded]);
  const focusDriftChart = useMemo(() => applyFocusDriftReplayReveal({
    chart: fullFocusDriftChart,
    language: effectiveLanguage,
    revealMinuteOfDay: clock.minute,
    startOfDayMinutes: ENTRY_DEMO_START_OF_DAY_MINUTES,
  }), [clock.minute, effectiveLanguage, fullFocusDriftChart]);
  const focusDuration = focusSeconds > 0
    ? formatLocalizedCompactDurationFromSeconds(focusSeconds, effectiveLanguage)
    : effectiveLanguage === "ko" ? "0분" : effectiveLanguage === "es" ? "0 min" : "0m";

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
        <div className="onb-entry-demo__card">
          <div className="page onb-entry-demo__page" data-fading={clock.fading ? "true" : "false"}>
            <div className="week-v2-grid week-v2-grid--calendar week-v2-grid--day week-v2-grid--side-open">
              <div className="day-split__main">
                <DashboardPageHeader
                  dashPeriod="Today"
                  initialDataLoading={false}
                  dateNavigator={null}
                  focusDuration={focusDuration}
                  headerAction={(
                    <span className="app-btn app-btn--secondary app-btn--header-action dashboard-share-button">
                      <ShareIcon />
                      <span>{t("dashboard.today.share")}</span>
                    </span>
                  )}
                />
                <div className="flow-breakdown-layout flow-breakdown-layout--full">
                  <div className="flow-breakdown-layout__chart">
                    <FlowChartView
                      blocks={flowBlocks}
                      appIcons={NO_APP_ICONS}
                      currentMinuteOfDay={clock.minute}
                      intervalMinutes={3}
                      startOfDayMinutes={ENTRY_DEMO_START_OF_DAY_MINUTES}
                      showEmptyGrid
                      colorMode="productivity"
                      onColorModeChange={NOOP}
                    />
                  </div>
                </div>
                <div className="dashboard-insight-stack">
                  <FocusDriftSection
                    appIcons={NO_APP_ICONS}
                    chart={focusDriftChart}
                    startOfDayMinutes={ENTRY_DEMO_START_OF_DAY_MINUTES}
                  />
                </div>
                <AppUsagePanel
                  items={appUsage}
                  periodLabel="today"
                  totalSeconds={recordedSeconds}
                  appIcons={NO_APP_ICONS}
                  emptyPresentation="blank"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
