import { useEffect, useMemo, useState } from "react";
import { shiftIsoDate } from "@drifty/domain";
import { SiteIconProvider } from "../../components/SiteIconContext";
import { logicalTodayIsoDate } from "../../lib/formatting";
import { useIntroReviewOverrides } from "./introReviewOverrides";
import { FirstDayPreparationScreen, type FirstDayPreparationPhase } from "./FirstDayPreparationScreen";
import { FIRST_DAY_PREPARATION_READY_HOLD_MS } from "./firstDayPreparationProgress";
import { buildFirstDayChart, buildFirstDayDiscoveries, buildFirstDayReadingSources } from "./firstDayPreparationStory";
import {
  buildFirstDayReviewAppIcons,
  buildFirstDayReviewSegments,
  buildFirstDayReviewSiteIcons,
  FIRST_DAY_REVIEW_BATCHES,
  FIRST_DAY_REVIEW_ENTRY_COUNT,
  FIRST_DAY_REVIEW_TIME_ORDER_BATCHES,
  firstDayReviewSegmentId,
} from "./firstDayPreparationReviewData";
import type { AppIconMap } from "@drifty/domain";

/** batchesDone: batches already classified; reading: the batch in flight (index), or null. */
type Stage = {
  readonly phase: FirstDayPreparationPhase;
  readonly progress: number | null;
  readonly loaded: boolean;
  readonly batchesDone: number;
  readonly reading: number | null;
};

/** How a review run is paced: which batches arrive, and how long each part of the wait takes. */
type Pace = {
  readonly batches: readonly (readonly number[])[];
  readonly readMs: number;
  readonly loadedMs: number;
  readonly batchMs: number;
  readonly tailMs: number;
  /** When set, the dashboard takes over this long after ready, as in the app. */
  readonly dashboardAfterMs: number | null;
};

/** The compact default: four source-grouped batches in about 21 seconds. */
const COMPACT_PACE: Pace = { batches: FIRST_DAY_REVIEW_BATCHES, readMs: 1800, loadedMs: 2200, batchMs: 4200, tailMs: 400, dashboardAfterMs: null };

/**
 * ?driftyFirstDayPace=real: a Cloud run that uses its whole 45-second foreground budget at real speed.
 * The tracker hands out unclassified activity in time order, so batches follow the clock and a source's
 * time can land across several of them; the dashboard takes over after the ready hold.
 */
const REAL_PACE: Pace = {
  batches: FIRST_DAY_REVIEW_TIME_ORDER_BATCHES,
  readMs: 4000,
  loadedMs: 2000,
  batchMs: 4600,
  tailMs: 600,
  dashboardAfterMs: FIRST_DAY_PREPARATION_READY_HOLD_MS,
};

const classifiedEntries = (pace: Pace, batchesDone: number) => pace.batches.slice(0, batchesDone).reduce((sum, batch) => sum + batch.length, 0);
const classifyingProgress = (pace: Pace, batchesDone: number) => 0.32 + 0.66 * (classifiedEntries(pace, batchesDone) / FIRST_DAY_REVIEW_ENTRY_COUNT);
const readyAt = (pace: Pace) => pace.readMs + pace.loadedMs + pace.batchMs * pace.batches.length + pace.tailMs;

// Held stages (?driftyFirstDayStage=0..5): reading, loaded, three points in classification, ready.
const STAGES: readonly Stage[] = [
  { phase: "importing", progress: null, loaded: false, batchesDone: 0, reading: null },
  { phase: "importing", progress: 0.3, loaded: true, batchesDone: 0, reading: null },
  { phase: "classifying", progress: classifyingProgress(COMPACT_PACE, 0), loaded: true, batchesDone: 0, reading: 0 },
  { phase: "classifying", progress: classifyingProgress(COMPACT_PACE, 1), loaded: true, batchesDone: 1, reading: 1 },
  { phase: "classifying", progress: classifyingProgress(COMPACT_PACE, 3), loaded: true, batchesDone: 3, reading: 3 },
  { phase: "ready", progress: 1, loaded: true, batchesDone: COMPACT_PACE.batches.length, reading: null },
];

function playedStage(pace: Pace, elapsedMs: number): Stage {
  const batchCount = pace.batches.length;
  if (elapsedMs < pace.readMs) return STAGES[0];
  if (elapsedMs < pace.readMs + pace.loadedMs) return STAGES[1];
  if (elapsedMs >= readyAt(pace)) return { phase: "ready", progress: 1, loaded: true, batchesDone: batchCount, reading: null };
  const batchesDone = Math.min(batchCount, Math.floor((elapsedMs - pace.readMs - pace.loadedMs) / pace.batchMs));
  return {
    phase: "classifying",
    progress: classifyingProgress(pace, batchesDone),
    loaded: true,
    batchesDone,
    reading: batchesDone < batchCount ? batchesDone : null,
  };
}

/**
 * Development review of the first-day preparation screen with a synthetic browser-history day.
 * Plays every stage in turn, or holds one with ?driftyFirstDayStage=0..5.
 */
export function FirstDayPreparationReview({ appIcons = {} }: { readonly appIcons?: AppIconMap }) {
  useIntroReviewOverrides(true, "macos");
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const pace = params.get("driftyFirstDayPace") === "real" ? REAL_PACE : COMPACT_PACE;
  const held = useMemo(() => {
    const value = params.get("driftyFirstDayStage");
    const stage = value === null ? NaN : Number(value);
    return Number.isInteger(stage) && stage >= 0 && stage < STAGES.length ? stage : null;
  }, [params]);
  const endAt = readyAt(pace) + (pace.dashboardAfterMs ?? 0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (held !== null) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAt;
      setElapsed(next);
      if (next >= endAt + 400) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [endAt, held]);
  // Capture scripts wait on this to take every capture at the same moment of the playback.
  useEffect(() => {
    document.documentElement.dataset.firstDayReviewElapsed = String(held !== null ? -1 : elapsed);
  }, [elapsed, held]);
  const stage = held !== null ? STAGES[held] : playedStage(pace, elapsed);
  const day = useMemo(() => shiftIsoDate(logicalTodayIsoDate(0), -1), []);
  const sourceMode = params.get("driftyFirstDaySources") === "mixed" ? "mixed" : "sites";
  const segments = useMemo(
    () => (stage.loaded ? buildFirstDayReviewSegments(day, new Set(pace.batches.slice(0, stage.batchesDone).flat()), sourceMode) : null),
    [day, pace, sourceMode, stage.batchesDone, stage.loaded],
  );
  const discoveries = useMemo(() => (segments ? buildFirstDayDiscoveries(segments) : null), [segments]);
  const chart = useMemo(() => (segments ? buildFirstDayChart(segments) : null), [segments]);
  const reading = useMemo(
    () => (segments && stage.reading !== null ? buildFirstDayReadingSources(segments, pace.batches[stage.reading].map(firstDayReviewSegmentId)) : []),
    [pace, segments, stage.reading],
  );
  const siteIcons = useMemo(buildFirstDayReviewSiteIcons, []);
  const reviewAppIcons = useMemo(() => ({ ...buildFirstDayReviewAppIcons(params.get("driftyReviewIconBase")), ...appIcons }), [appIcons, params]);
  if (held === null && pace.dashboardAfterMs !== null && elapsed >= endAt) {
    // Stand-in for the dashboard, so a real-speed review shows how briefly ready is on screen.
    return (
      <div className="first-day-prep" data-first-day-review-dashboard="">
        <p className="first-day-prep__line">Dashboard</p>
      </div>
    );
  }
  return (
    <SiteIconProvider value={siteIcons}>
      <FirstDayPreparationScreen
        phase={stage.phase}
        plan={["importing", "classifying"]}
        progress={stage.progress}
        discoveries={discoveries}
        appIcons={reviewAppIcons}
        chart={chart}
        dayRelation="yesterday"
        workActivityLabel="Designing"
        reading={reading}
      />
    </SiteIconProvider>
  );
}
