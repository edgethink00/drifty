import {
  aggregateDeviceElapsedTime,
  activityTimeBounds,
  appUsageGroupKey,
  classifyActivity,
  clipDeviceElapsedTimeSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  logicalDayIsoDateForDate,
  logicalDayEndExclusiveMs,
  type ActivityCategory,
  type ActivitySegment,
  type ClassificationOptions,
} from "@drifty/domain";
import { historyRowTitle } from "../history/historyGroups";
import {
  getInsightSurfaceIdentity,
  listFocusDriftTransitions,
  type InsightSourceItem,
  type InsightSourceLists,
  type ProductivityAnalysisKind,
} from "./insightData";

export const INSIGHT_EVIDENCE_PANEL_ID = "insight-evidence-panel";

/** Which number on the usage tab the reader asked about. */
export type InsightEvidenceTarget = {
  readonly variant: ProductivityAnalysisKind;
  readonly list: keyof InsightSourceLists;
  readonly itemId: string;
};

export type OpenInsightEvidence = {
  readonly target: InsightEvidenceTarget;
  /** The row as clicked, so the header keeps its name if a new range no longer has it. */
  readonly item: InsightSourceItem;
  /** Opened from nothing (slides in) rather than replacing another row's records. */
  readonly openedFromClosed: boolean;
};

export function insightEvidenceKey(target: InsightEvidenceTarget): string {
  return `${target.variant}:${target.list}:${target.itemId}`;
}

export type InsightEvidenceRecord = {
  readonly id: string;
  readonly segmentIds: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly title: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
  readonly category: ActivityCategory;
};

export type InsightEvidenceSurface = {
  readonly label: string;
  readonly title: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
};

export type InsightEvidenceSwitch = {
  readonly id: string;
  /** When the drift record started, i.e. the moment of the switch. */
  readonly at: string;
  readonly from: InsightEvidenceSurface;
  readonly to: InsightEvidenceSurface;
  /** Seconds of the side the list counts: the drift record for "Drift after focus", the focus record for "Focus before drift". */
  readonly durationSeconds: number;
};

export type InsightEvidenceDay<T> = {
  readonly dayKey: string;
  readonly totalSeconds: number;
  readonly entries: readonly T[];
};

export type InsightEvidence =
  | {
    readonly kind: "records";
    readonly totalSeconds: number;
    readonly recordCount: number;
    readonly days: readonly InsightEvidenceDay<InsightEvidenceRecord>[];
  }
  | {
    readonly kind: "switches";
    readonly totalSeconds: number;
    readonly count: number;
    readonly days: readonly InsightEvidenceDay<InsightEvidenceSwitch>[];
  };

/**
 * Consecutive records on the same page or window with no more than this gap
 * between them read as one stretch, as they do in History.
 */
const RECORD_MERGE_GAP_MS = 15_000;

/**
 * The records behind one row of the usage tab's source lists. It filters with
 * the same productivity, elapsed-time and grouping rules the list used, so the
 * records always add up to the number the reader clicked.
 */
export function buildInsightEvidence(
  segments: readonly ActivitySegment[],
  target: InsightEvidenceTarget,
  item: Pick<InsightSourceItem, "groupKey">,
  options: ClassificationOptions | undefined,
  startOfDayMinutes = 0,
): InsightEvidence {
  return target.list === "apps"
    ? buildRecordEvidence(segments, target.variant, item.groupKey, options, startOfDayMinutes)
    : buildSwitchEvidence(segments, target.variant, item.groupKey, options, startOfDayMinutes);
}

function buildRecordEvidence(
  segments: readonly ActivitySegment[],
  variant: ProductivityAnalysisKind,
  groupKey: string,
  options: ClassificationOptions | undefined,
  startOfDayMinutes: number,
): InsightEvidence {
  const matching = aggregateDeviceElapsedTime(
    segments.filter((segment) => classifyActivity(segment, options).productivity === variant),
  ).filter((segment) => (
    !isFailedForegroundCaptureSegment(segment)
    && !isExcludedSegment(segment)
    && appUsageGroupKey(segment) === groupKey
  ));

  const recordsByDay = new Map<string, ActivitySegment[]>();
  for (const segment of matching) {
    const bounds = activityTimeBounds(segment);
    if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) continue;
    let cursor = bounds.start;
    while (cursor < bounds.end) {
      const day = logicalDayIsoDateForDate(new Date(cursor), startOfDayMinutes);
      const end = Math.min(bounds.end, logicalDayEndExclusiveMs(day, startOfDayMinutes));
      if (!(end > cursor)) break;
      const clipped = clipDeviceElapsedTimeSegment(segment, { start: cursor, end });
      if (clipped.durationSeconds > 0) {
        const entries = recordsByDay.get(day) ?? [];
        // Display bounds only: input captures remain intact, and segmentIds
        // still resolve back to those original records.
        entries.push({ ...clipped, startedAt: new Date(cursor).toISOString(), endedAt: new Date(end).toISOString() });
        recordsByDay.set(day, entries);
      }
      cursor = end;
    }
  }
  const days = [...recordsByDay.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([dayKey, segments]) => {
    const entries = mergeRecords(segments, options);
    return { dayKey, entries, totalSeconds: entries.reduce((sum, record) => sum + record.durationSeconds, 0) };
  });
  return {
    kind: "records",
    totalSeconds: days.reduce((sum, day) => sum + day.totalSeconds, 0),
    recordCount: days.reduce((sum, day) => sum + day.entries.length, 0),
    days,
  };
}

function buildSwitchEvidence(
  segments: readonly ActivitySegment[],
  variant: ProductivityAnalysisKind,
  groupKey: string,
  options: ClassificationOptions | undefined,
  startOfDayMinutes: number,
): InsightEvidence {
  const switches: InsightEvidenceSwitch[] = [];
  for (const transition of listFocusDriftTransitions(segments, options)) {
    const subject = variant === "drift" ? transition.drift : transition.focus;
    if (getInsightSurfaceIdentity(subject).id !== groupKey) continue;
    switches.push({
      id: `${transition.focus.id}->${transition.drift.id}`,
      at: transition.drift.startedAt,
      from: evidenceSurface(transition.focus),
      to: evidenceSurface(transition.drift),
      durationSeconds: subject.durationSeconds,
    });
  }
  switches.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const days = groupByDay(switches, (entry) => entry.at, (entry) => entry.durationSeconds, startOfDayMinutes);
  return {
    kind: "switches",
    totalSeconds: switches.reduce((sum, entry) => sum + entry.durationSeconds, 0),
    count: switches.length,
    days,
  };
}

function evidenceSurface(segment: ActivitySegment): InsightEvidenceSurface {
  const identity = getInsightSurfaceIdentity(segment);
  return {
    label: identity.label,
    title: historyRowTitle(segment),
    appName: identity.appName,
    bundleId: identity.bundleId,
    siteDomain: identity.siteDomain,
  };
}

/** Newest first, like History. */
function mergeRecords(segments: readonly ActivitySegment[], options: ClassificationOptions | undefined): InsightEvidenceRecord[] {
  const sorted = segments.slice().sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const records: Array<InsightEvidenceRecord & { segmentIds: string[]; endedAt: string; durationSeconds: number }> = [];
  for (const segment of sorted) {
    const title = historyRowTitle(segment);
    const category = classifyActivity(segment, options).category;
    const previous = records[records.length - 1];
    if (
      previous
      && previous.title === title
      && previous.appName === segment.appName
      && previous.category === category
      && Date.parse(segment.startedAt) - Date.parse(previous.endedAt) <= RECORD_MERGE_GAP_MS
    ) {
      if (!previous.segmentIds.includes(segment.id)) previous.segmentIds.push(segment.id);
      previous.durationSeconds += segment.durationSeconds;
      if (segment.endedAt > previous.endedAt) previous.endedAt = segment.endedAt;
      continue;
    }
    records.push({
      id: segment.id,
      segmentIds: [segment.id],
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      durationSeconds: segment.durationSeconds,
      title,
      appName: segment.appName,
      bundleId: segment.bundleId ?? null,
      siteDomain: segment.siteDomain?.trim() || null,
      category,
    });
  }
  return records.reverse();
}

function groupByDay<T>(
  entries: readonly T[],
  startedAt: (entry: T) => string,
  seconds: (entry: T) => number,
  startOfDayMinutes: number,
): InsightEvidenceDay<T>[] {
  const days = new Map<string, { dayKey: string; totalSeconds: number; entries: T[] }>();
  for (const entry of entries) {
    const dayKey = logicalDayIsoDateForDate(new Date(startedAt(entry)), startOfDayMinutes);
    const day = days.get(dayKey) ?? { dayKey, totalSeconds: 0, entries: [] };
    day.entries.push(entry);
    day.totalSeconds += seconds(entry);
    days.set(dayKey, day);
  }
  return Array.from(days.values());
}
