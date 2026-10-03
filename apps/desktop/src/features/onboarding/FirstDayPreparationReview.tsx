import { useEffect, useMemo, useState } from "react";
import { shiftIsoDate } from "@drifty/domain";
import { SiteIconProvider } from "../../components/SiteIconContext";
import { logicalTodayIsoDate } from "../../lib/formatting";
import { useIntroReviewOverrides } from "./introReviewOverrides";
import { FirstDayPreparationScreen, type FirstDayPreparationPhase } from "./FirstDayPreparationScreen";
import { buildFirstDayChart, buildFirstDayDiscoveries } from "./firstDayPreparationStory";
import { buildFirstDayReviewAppIcons, buildFirstDayReviewSegments, buildFirstDayReviewSiteIcons, FIRST_DAY_REVIEW_ENTRY_COUNT } from "./firstDayPreparationReviewData";
import type { AppIconMap } from "@drifty/domain";

type Stage = { readonly phase: FirstDayPreparationPhase; readonly progress: number | null; readonly loaded: boolean; readonly classified: number };

const STAGES: readonly Stage[] = [
  { phase: "importing", progress: null, loaded: false, classified: 0 },
  { phase: "importing", progress: 0.3, loaded: true, classified: 0 },
  { phase: "classifying", progress: 0.46, loaded: true, classified: 5 },
  { phase: "classifying", progress: 0.66, loaded: true, classified: 13 },
  { phase: "classifying", progress: 0.9, loaded: true, classified: FIRST_DAY_REVIEW_ENTRY_COUNT },
  { phase: "ready", progress: 1, loaded: true, classified: FIRST_DAY_REVIEW_ENTRY_COUNT },
];

/**
 * The played review: reading, the day loading, then classification arriving one source at a time
 * (as Cloud and local batches do), then ready.
 */
const READ_MS = 1800;
const LOADED_MS = 2200;
const CLASSIFY_TICK_MS = 300;
const READY_AT_MS = READ_MS + LOADED_MS + CLASSIFY_TICK_MS * (FIRST_DAY_REVIEW_ENTRY_COUNT + 2);

function playedStage(elapsedMs: number): Stage {
  if (elapsedMs < READ_MS) return STAGES[0];
  if (elapsedMs < READ_MS + LOADED_MS) return STAGES[1];
  if (elapsedMs >= READY_AT_MS) return STAGES[5];
  const classified = Math.min(FIRST_DAY_REVIEW_ENTRY_COUNT, Math.floor((elapsedMs - READ_MS - LOADED_MS) / CLASSIFY_TICK_MS));
  return { phase: "classifying", progress: 0.32 + 0.62 * (classified / FIRST_DAY_REVIEW_ENTRY_COUNT), loaded: true, classified };
}

/**
 * Development review of the first-day preparation screen with a synthetic browser-history day.
 * Plays every stage in turn, or holds one with ?driftyFirstDayStage=0..5.
 */
export function FirstDayPreparationReview({ appIcons = {} }: { readonly appIcons?: AppIconMap }) {
  useIntroReviewOverrides(true, "macos");
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const held = useMemo(() => {
    const value = params.get("driftyFirstDayStage");
    const stage = value === null ? NaN : Number(value);
    return Number.isInteger(stage) && stage >= 0 && stage < STAGES.length ? stage : null;
  }, [params]);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (held !== null) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAt;
      setElapsed(next);
      if (next >= READY_AT_MS) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [held]);
  const stage = held !== null ? STAGES[held] : playedStage(elapsed);
  const day = useMemo(() => shiftIsoDate(logicalTodayIsoDate(0), -1), []);
  const segments = useMemo(
    () => (stage.loaded ? buildFirstDayReviewSegments(day, stage.classified, params.get("driftyFirstDaySources") === "mixed" ? "mixed" : "sites") : null),
    [day, params, stage.classified, stage.loaded],
  );
  const discoveries = useMemo(() => (segments ? buildFirstDayDiscoveries(segments) : null), [segments]);
  const chart = useMemo(() => (segments ? buildFirstDayChart(segments) : null), [segments]);
  const siteIcons = useMemo(buildFirstDayReviewSiteIcons, []);
  const reviewAppIcons = useMemo(() => ({ ...buildFirstDayReviewAppIcons(params.get("driftyReviewIconBase")), ...appIcons }), [appIcons, params]);
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
      />
    </SiteIconProvider>
  );
}

