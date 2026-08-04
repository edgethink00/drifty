import {
  categorizeActivity,
  logicalDayIsoDateForDate,
  shiftIsoDate,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";
import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";

export type CompanionFocusRecordId = "record7d" | "record14d" | "record30d";

type CompanionFocusRecordDefinition = {
  readonly id: CompanionFocusRecordId;
  readonly days: 7 | 14 | 30;
  readonly minTrackedDays: number;
};

export const COMPANION_FOCUS_RECORDS: readonly CompanionFocusRecordDefinition[] = [
  { id: "record7d", days: 7, minTrackedDays: 4 },
  { id: "record14d", days: 14, minTrackedDays: 7 },
  { id: "record30d", days: 30, minTrackedDays: 14 },
];

export type CompanionFocusRunRecordBaseline = {
  readonly bestSeconds: Readonly<Record<CompanionFocusRecordId, number>>;
  readonly trackedDays: Readonly<Record<CompanionFocusRecordId, number>>;
};

export type CompanionFocusRunRecordProgress = {
  readonly day: string;
  readonly observedRunSeconds: number;
  readonly bestSeconds: Readonly<Record<CompanionFocusRecordId, number>>;
  readonly announcedForRun: readonly CompanionFocusRecordId[];
};

const MAX_FOCUS_RUN_GAP_MS = 5 * 60 * 1000;
const MIN_RECORD_RUN_SECONDS = 25 * 60;

type FocusRunPart = { readonly day: string; readonly seconds: number };

/** Build trailing-window records from productivity classifications, not apps. */
export function buildCompanionFocusRunRecordBaseline({
  segments,
  day,
  startOfDayMinutes,
  classificationOptions,
}: {
  readonly segments: readonly ActivitySegment[];
  readonly day: string;
  readonly startOfDayMinutes: number;
  readonly classificationOptions?: ClassificationOptions;
}): CompanionFocusRunRecordBaseline {
  const ordered = segments
    .filter((segment) => segment.durationSeconds > 0)
    .slice()
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const options: ClassificationOptions = {
    ...classificationOptions,
    fallbackCandidates: ordered,
  };
  const runs: FocusRunPart[][] = [];
  const trackedDaySet = new Set<string>();
  let activeRun: FocusRunPart[] = [];
  let activeRunEndMs = Number.NEGATIVE_INFINITY;

  const finishRun = () => {
    if (activeRun.length > 0) runs.push(activeRun);
    activeRun = [];
    activeRunEndMs = Number.NEGATIVE_INFINITY;
  };

  for (const segment of ordered) {
    const startedAt = new Date(segment.startedAt);
    const endedAt = new Date(segment.endedAt);
    const startMs = startedAt.getTime();
    const endMs = endedAt.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const logicalDay = logicalDayIsoDateForDate(startedAt, startOfDayMinutes);
    trackedDaySet.add(logicalDay);

    const isFocus = categorizeActivity(segment, options) === "focus";
    if (!isFocus) {
      finishRun();
      continue;
    }

    if (activeRun.length > 0 && startMs > activeRunEndMs + MAX_FOCUS_RUN_GAP_MS) finishRun();
    activeRun.push({ day: logicalDay, seconds: Math.max(0, Math.floor(segment.durationSeconds)) });
    activeRunEndMs = Math.max(activeRunEndMs, endMs);
  }
  finishRun();

  const bestSeconds = emptyRecordNumberMap();
  const trackedDays = emptyRecordNumberMap();
  for (const definition of COMPANION_FOCUS_RECORDS) {
    const startDay = shiftIsoDate(day, -(definition.days - 1));
    trackedDays[definition.id] = Array.from(trackedDaySet)
      .filter((trackedDay) => trackedDay >= startDay && trackedDay <= day)
      .length;
    bestSeconds[definition.id] = runs.reduce((best, run) => {
      const seconds = run.reduce(
        (total, part) => total + (part.day >= startDay && part.day <= day ? part.seconds : 0),
        0,
      );
      return Math.max(best, seconds);
    }, 0);
  }

  return { bestSeconds, trackedDays };
}

/** Baseline the run already on screen so launch never replays an old record. */
export function initializeCompanionFocusRunRecords(
  day: string,
  currentRunSeconds: number,
  baseline: CompanionFocusRunRecordBaseline,
): CompanionFocusRunRecordProgress {
  const normalizedRun = normalizeSeconds(currentRunSeconds);
  const bestSeconds = emptyRecordNumberMap();
  const announcedForRun: CompanionFocusRecordId[] = [];

  for (const definition of COMPANION_FOCUS_RECORDS) {
    bestSeconds[definition.id] = Math.max(baseline.bestSeconds[definition.id], normalizedRun);
    if (
      normalizedRun >= MIN_RECORD_RUN_SECONDS
      && normalizedRun >= bestSeconds[definition.id]
      && baseline.trackedDays[definition.id] >= definition.minTrackedDays
    ) {
      announcedForRun.push(definition.id);
    }
  }

  return { day, observedRunSeconds: normalizedRun, bestSeconds, announcedForRun };
}

export function evaluateCompanionFocusRunRecords({
  progress,
  day,
  currentRunSeconds,
  trackedDays,
  announce,
}: {
  readonly progress: CompanionFocusRunRecordProgress;
  readonly day: string;
  readonly currentRunSeconds: number;
  readonly trackedDays: Readonly<Record<CompanionFocusRecordId, number>>;
  readonly announce: boolean;
}): { readonly progress: CompanionFocusRunRecordProgress; readonly events: readonly CompanionPillMilestoneEvent[] } {
  if (progress.day !== day) return { progress, events: [] };

  const normalizedRun = normalizeSeconds(currentRunSeconds);
  /* A classification correction may trim a live run by a few seconds. Only a
     real non-Focus observation (the run reaching zero) opens a new record
     attempt; otherwise the same run could celebrate twice after correction. */
  const runRestarted = normalizedRun === 0 && progress.observedRunSeconds > 0;
  const announced = new Set<CompanionFocusRecordId>(runRestarted ? [] : progress.announcedForRun);
  const bestSeconds = { ...progress.bestSeconds };
  const events: CompanionPillMilestoneEvent[] = [];

  for (const definition of COMPANION_FOCUS_RECORDS) {
    const previousBest = bestSeconds[definition.id];
    const qualifies = normalizedRun >= MIN_RECORD_RUN_SECONDS
      && trackedDays[definition.id] >= definition.minTrackedDays
      && normalizedRun > previousBest;
    if (qualifies && !announced.has(definition.id)) {
      announced.add(definition.id);
      if (announce) events.push(buildFocusRecordEvent(definition, day, normalizedRun, previousBest));
    }
    bestSeconds[definition.id] = Math.max(previousBest, normalizedRun);
  }

  return {
    progress: {
      day,
      observedRunSeconds: normalizedRun,
      bestSeconds,
      announcedForRun: COMPANION_FOCUS_RECORDS.map((record) => record.id)
        .filter((id) => announced.has(id)),
    },
    events,
  };
}

function buildFocusRecordEvent(
  definition: CompanionFocusRecordDefinition,
  day: string,
  currentRunSeconds: number,
  previousBestSeconds: number,
): CompanionPillMilestoneEvent {
  return {
    kind: "milestone",
    id: `companion-focus-record:${day}:${definition.id}:${currentRunSeconds}`,
    milestoneKind: "record",
    tier: 3,
    title: `Longest focus in ${definition.days} days`,
    subtitle: previousBestSeconds > 0
      ? `Past your previous best of ${formatMinutes(previousBestSeconds)}`
      : "Your first meaningful focus record",
    destination: "insights",
    statSeconds: currentRunSeconds,
  };
}

function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

function normalizeSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function emptyRecordNumberMap(): Record<CompanionFocusRecordId, number> {
  return { record7d: 0, record14d: 0, record30d: 0 };
}
