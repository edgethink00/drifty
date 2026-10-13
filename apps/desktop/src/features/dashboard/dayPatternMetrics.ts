import {
  classifyActivityDetailed,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";
import {
  joinProductivityRuns,
  longestProductivityRun,
  toProductivityRunPart,
  type ProductivityRun,
  type ProductivityRunPart,
} from "../../lib/productivityRuns";
import { getInsightSurfaceIdentity } from "../insights/insightData";

/** A visit shorter than this is a pass-through, not a switch. */
export const SWITCH_MIN_STAY_SECONDS = 10;

/** Run length that fills the streak chart's full height. */
export const STREAK_CHART_FULL_HEIGHT_SECONDS = 90 * 60;

const HOUR_MS = 60 * 60 * 1000;

export type DayPatternSurface = {
  readonly id: string;
  readonly label: string;
  readonly seconds: number;
};

export type DayPatternSwitches = {
  readonly count: number;
  readonly perHour: number;
  readonly averageStaySeconds: number;
};

export type DayPatternMetrics = {
  readonly trackedSeconds: number;
  readonly classifiedSeconds: number;
  /** Whole-hour bounds around the day's recorded activity, for the streak axis. */
  readonly span: { readonly startMs: number; readonly endMs: number } | null;
  readonly focusRuns: readonly ProductivityRun[];
  readonly longestFocus: ProductivityRun | null;
  readonly longestDrift: ProductivityRun | null;
  readonly topFocus: DayPatternSurface | null;
  readonly topDrift: DayPatternSurface | null;
  readonly switches: DayPatternSwitches | null;
};

export const EMPTY_DAY_PATTERN_METRICS: DayPatternMetrics = {
  trackedSeconds: 0,
  classifiedSeconds: 0,
  span: null,
  focusRuns: [],
  longestFocus: null,
  longestDrift: null,
  topFocus: null,
  topDrift: null,
  switches: null,
};

/**
 * Day patterns for the Breakdown panel. Each segment is classified once with
 * the same options as the panel's productivity ring, so these numbers agree
 * with the ring's Focus and Drift totals.
 */
export function buildDayPatternMetrics(
  segments: readonly ActivitySegment[],
  classificationOptions?: ClassificationOptions,
): DayPatternMetrics {
  if (segments.length === 0) return EMPTY_DAY_PATTERN_METRICS;

  let trackedSeconds = 0;
  let classifiedSeconds = 0;
  let firstStartMs = Number.POSITIVE_INFINITY;
  let lastEndMs = Number.NEGATIVE_INFINITY;
  const focusParts: ProductivityRunPart[] = [];
  const driftParts: ProductivityRunPart[] = [];
  const focusSurfaces = new Map<string, DayPatternSurface>();
  const driftSurfaces = new Map<string, DayPatternSurface>();

  for (const segment of segments) {
    const seconds = Math.max(0, segment.durationSeconds);
    trackedSeconds += seconds;
    const part = toProductivityRunPart(segment);
    if (Number.isFinite(part.startMs) && Number.isFinite(part.endMs)) {
      firstStartMs = Math.min(firstStartMs, part.startMs);
      lastEndMs = Math.max(lastEndMs, part.endMs);
    }

    const classification = classifyActivityDetailed(segment, classificationOptions);
    if (classification.category === "unknown") continue;
    classifiedSeconds += seconds;
    if (classification.productivity === "focus") {
      focusParts.push(part);
      addSurfaceSeconds(focusSurfaces, segment, seconds);
    } else if (classification.productivity === "drift") {
      driftParts.push(part);
      addSurfaceSeconds(driftSurfaces, segment, seconds);
    }
  }

  const focusRuns = joinProductivityRuns(focusParts);
  return {
    trackedSeconds,
    classifiedSeconds,
    span: buildHourSpan(firstStartMs, lastEndMs),
    focusRuns,
    longestFocus: longestProductivityRun(focusRuns),
    longestDrift: longestProductivityRun(joinProductivityRuns(driftParts)),
    topFocus: largestSurface(focusSurfaces),
    topDrift: largestSurface(driftSurfaces),
    switches: buildSwitches(segments, trackedSeconds),
  };
}

function addSurfaceSeconds(surfaces: Map<string, DayPatternSurface>, segment: ActivitySegment, seconds: number) {
  const identity = getInsightSurfaceIdentity(segment);
  const current = surfaces.get(identity.id);
  surfaces.set(identity.id, { id: identity.id, label: identity.label, seconds: (current?.seconds ?? 0) + seconds });
}

function largestSurface(surfaces: Map<string, DayPatternSurface>): DayPatternSurface | null {
  let best: DayPatternSurface | null = null;
  for (const surface of surfaces.values()) {
    if (surface.seconds > 0 && (best === null || surface.seconds > best.seconds)) best = surface;
  }
  return best;
}

function buildHourSpan(firstStartMs: number, lastEndMs: number): DayPatternMetrics["span"] {
  if (!Number.isFinite(firstStartMs) || !Number.isFinite(lastEndMs) || lastEndMs <= firstStartMs) return null;
  const start = new Date(firstStartMs);
  start.setMinutes(0, 0, 0);
  const end = new Date(lastEndMs);
  if (end.getMinutes() !== 0 || end.getSeconds() !== 0 || end.getMilliseconds() !== 0) {
    end.setMinutes(0, 0, 0);
    end.setTime(end.getTime() + HOUR_MS);
  }
  const startMs = start.getTime();
  return { startMs, endMs: Math.max(end.getTime(), startMs + HOUR_MS) };
}

/**
 * Moves between apps or sites. Visits shorter than SWITCH_MIN_STAY_SECONDS
 * are skipped, so passing through an app on the way elsewhere is not counted,
 * and back-to-back segments of one app or site form one visit.
 */
function buildSwitches(segments: readonly ActivitySegment[], trackedSeconds: number): DayPatternSwitches | null {
  const orderedSegments = segments
    .filter((segment) => Number.isFinite(Date.parse(segment.startedAt)) && Number.isFinite(segment.durationSeconds))
    .slice()
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));

  // One app or site visit can span multiple tracker segments when its window
  // title or page context changes. Combine those before applying the threshold
  // so two six-second captures still count as one twelve-second visit.
  const observedVisits: Array<{ key: string; seconds: number }> = [];
  for (const segment of orderedSegments) {
    const key = switchSurfaceKey(segment);
    const seconds = Math.max(0, segment.durationSeconds);
    const current = observedVisits[observedVisits.length - 1];
    if (current?.key === key) {
      current.seconds += seconds;
    } else {
      observedVisits.push({ key, seconds });
    }
  }

  // Drop short pass-throughs, then collapse the same surface on either side
  // of one so it does not create a false switch (A → 5s B → A remains one stay).
  const visits: Array<{ key: string; seconds: number }> = [];
  for (const visit of observedVisits) {
    if (visit.seconds < SWITCH_MIN_STAY_SECONDS) continue;
    const previous = visits[visits.length - 1];
    if (previous?.key === visit.key) previous.seconds += visit.seconds;
    else visits.push({ ...visit });
  }

  const visitCount = visits.length;
  if (visitCount === 0 || trackedSeconds <= 0) return null;
  const count = visitCount - 1;
  const visitedSeconds = visits.reduce((total, visit) => total + visit.seconds, 0);
  return {
    count,
    perHour: count / (trackedSeconds / 3600),
    averageStaySeconds: visitedSeconds / visitCount,
  };
}

function switchSurfaceKey(segment: ActivitySegment): string {
  const domain = segment.siteDomain?.trim().toLowerCase().replace(/^www\./u, "");
  if (domain) return `site:${domain}`;
  return `app:${segment.bundleId?.trim() || segment.appName.trim().toLowerCase()}`;
}

/** Bar height in pixels for a run on the streak chart. */
export function streakBarHeight(seconds: number, chartHeight: number, minHeight: number): number {
  const share = Math.min(Math.max(seconds, 0), STREAK_CHART_FULL_HEIGHT_SECONDS) / STREAK_CHART_FULL_HEIGHT_SECONDS;
  return Math.round(minHeight + share * (chartHeight - minHeight));
}
