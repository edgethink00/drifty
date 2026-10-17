import { aggregateDeviceElapsedTime, activitySecondsWithinInterval, activityTimeBounds, sampledActivitySecondsWithinInterval, sampledActivityTimeBounds, classifyActivityDetailed, isExcludedSegment, logicalDayEndExclusiveMs, logicalDayStartMs, shiftIsoDate } from "@drifty/domain";
import type { ExclusionSource } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions, ClassificationSource, ProductivityLabel } from "@drifty/domain";
import { DEFAULT_START_OF_WEEK } from "../settings/settingsStorage";
import type { StartOfWeek } from "../settings/settingsStorage";
import { categoryLabel } from "../../lib/activityLabels";
import { UI_LOCALE, buildIsoDayList, formatCalendarMinuteLabel, formatCompactDurationFromSeconds } from "../../lib/formatting";
import type { CSSProperties } from "react";
import { buildLogicalDayDrawingBuckets } from "./logicalDayDrawingBuckets";

export type WeekCategorySlice = {
  category: ActivityCategory;
  totalSeconds: number;
  ratio: number;
  /** The neutral part of totalSeconds; an added productivity level shows it under its own name. */
  neutralSeconds?: number;
};

export type WeekProductivitySlice = {
  productivity: ProductivityLabel;
  totalSeconds: number;
  ratio: number;
};

export type WeekDayRow = {
  day: string;
  dayName: string;
  dayNumber: string;
  totalSeconds: number;
  focusSeconds: number;
  focusScore: number;
  slices: WeekCategorySlice[];
  productivitySlices: WeekProductivitySlice[];
};

export type WeekCalendarIdentity = {
  id: string;
  label: string;
  appName: string;
  bundleId: string | null;
  browserName: string | null;
  siteDomain: string | null;
  siteTitle: string | null;
  exclusionSource?: ExclusionSource | null;
};

export type WeekCalendarEventIdentity = WeekCalendarIdentity & {
  seconds: number;
  firstStartMinute: number;
  sourceSegmentIds?: readonly string[];
};

export type WeekCalendarEvent = {
  /** Range-specific label identity when one captured record spans several cards. */
  activityLabelKey?: string;
  timelineCardKey?: string;
  /** Dominant project color metadata on an unchanged calendar block; null is No project. */
  projectId?: string | null;
  projectName?: string;
  projectColor?: string;
  hasMixedProject?: boolean;
  id: string;
  /** Full captured records contributing to this rendered aggregate. Mutations
   *  intentionally operate on these records, never on the visual time slice. */
  segmentIds: string[];
  appName: string;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  startLabel: string;
  endLabel: string;
  detailSummary: string;
  detailTitle: string;
  sessionCount: number;
  identities: WeekCalendarEventIdentity[];
  hiddenIdentityCount: number;
  isGroupedCluster: boolean;
  hasMixedCategory: boolean;
  hasMixedProductivity: boolean;
  classificationSource: ClassificationSource;
  aiClassification: boolean;
  topMinutes: number;
  activeDurationMinutes: number;
  durationMinutes: number;
  isShort: boolean;
  lane: number;
  laneCount: number;
};

export type WeekCalendarEventStyle = CSSProperties & {
  "--event-tone"?: string;
};

export type WeekCalendarNowMarkerStyle = CSSProperties & {
  "--week-calendar-now-offset": string;
  "--week-calendar-now-line-end": string;
};

export type WeekSegmentClassification = ReturnType<typeof classifyActivityDetailed>;

export function buildWeekDayRows(
  segments: ActivitySegment[],
  startDay: string,
  endDay: string,
  classificationOptions?: ClassificationOptions,
  startOfDayMinutes = 0,
  classificationBySegmentId?: ReadonlyMap<string, WeekSegmentClassification>,
): WeekDayRow[] {
  const days = buildIsoDayList(startDay, endDay);

  const rows = new Map<string, { totalSeconds: number; focusSeconds: number; categories: Map<ActivityCategory, number>; neutralCategories: Map<ActivityCategory, number>; productivity: Map<ProductivityLabel, number> }>();
  for (const day of days) {
    rows.set(day, { totalSeconds: 0, focusSeconds: 0, categories: new Map(), neutralCategories: new Map(), productivity: new Map() });
  }

  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const classification = classificationBySegmentId?.get(segment.id) ?? classifyActivityDetailed(segment, classificationOptions);
    for (const overlap of splitSegmentIntoDayOverlaps(segment, startDay, endDay, startOfDayMinutes)) {
      const row = rows.get(overlap.day);
      if (!row) continue;
      row.totalSeconds += overlap.durationSeconds;
      if (classification.productivity === "focus") row.focusSeconds += overlap.durationSeconds;
      row.categories.set(classification.category, (row.categories.get(classification.category) ?? 0) + overlap.durationSeconds);
      if (classification.productivity === "neutral") row.neutralCategories.set(classification.category, (row.neutralCategories.get(classification.category) ?? 0) + overlap.durationSeconds);
      row.productivity.set(classification.productivity, (row.productivity.get(classification.productivity) ?? 0) + overlap.durationSeconds);
    }
  }

  return days.map((day) => {
    const row = rows.get(day)!;
    const date = new Date(`${day}T12:00:00`);
    const slices = Array.from(row.categories.entries())
      .map(([category, total]) => ({ category, totalSeconds: total, ratio: row.totalSeconds > 0 ? total / row.totalSeconds : 0, neutralSeconds: row.neutralCategories.get(category) ?? 0 }))
      .filter((slice) => slice.totalSeconds > 0)
      .sort((left, right) => right.totalSeconds - left.totalSeconds);
    const productivitySlices = Array.from(row.productivity.entries())
      .map(([productivity, total]) => ({ productivity, totalSeconds: total, ratio: row.totalSeconds > 0 ? total / row.totalSeconds : 0 }))
      .filter((slice) => slice.totalSeconds > 0)
      .sort((left, right) => right.totalSeconds - left.totalSeconds);

    return {
      day,
      dayName: new Intl.DateTimeFormat(UI_LOCALE, { weekday: "short" }).format(date),
      dayNumber: new Intl.DateTimeFormat(UI_LOCALE, { day: "numeric" }).format(date),
      totalSeconds: row.totalSeconds,
      focusSeconds: row.focusSeconds,
      focusScore: row.totalSeconds > 0 ? Math.round((row.focusSeconds / row.totalSeconds) * 100) : 0,
      slices,
      productivitySlices,
    };
  });
}

export type SegmentDayOverlap = {
  day: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
};

export function splitSegmentIntoDayOverlaps(segment: ActivitySegment, startDay: string, endDay: string, startOfDayMinutes = 0, { sampledTime = false }: { sampledTime?: boolean } = {}): SegmentDayOverlap[] {
  const { start: segmentStartMs, end: segmentEndMs } = sampledTime ? sampledActivityTimeBounds(segment) : activityTimeBounds(segment);
  if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs) || segmentEndMs <= segmentStartMs) return [];

  return buildIsoDayList(startDay, endDay).flatMap((day) => {
    const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
    const dayEndMs = logicalDayEndExclusiveMs(day, startOfDayMinutes);
    const overlapStartMs = Math.max(segmentStartMs, dayStartMs);
    const overlapEndMs = Math.min(segmentEndMs, dayEndMs);
    if (overlapEndMs <= overlapStartMs) return [];
    return [{
      day,
      startedAt: new Date(overlapStartMs),
      endedAt: new Date(overlapEndMs),
      durationSeconds: (sampledTime ? sampledActivitySecondsWithinInterval : activitySecondsWithinInterval)(segment, overlapStartMs, overlapEndMs),
    }];
  });
}

export function buildWeekCalendarEvents(
  segments: ActivitySegment[],
  startDay: string,
  endDay: string,
  startHour: number,
  endHour: number,
  classificationOptions?: ClassificationOptions,
  startOfDayMinutes = 0,
  classificationBySegmentId?: ReadonlyMap<string, WeekSegmentClassification>,
  { sampledTime = false }: { sampledTime?: boolean } = {},
): Map<string, WeekCalendarEvent[]> {
  const days = buildIsoDayList(startDay, endDay);

  const eventsByDay = new Map<string, WeekCalendarEvent[]>(days.map((day) => [day, []]));
  const minMinute = startHour * 60;
  const maxMinute = endHour * 60;
  const bucketMinutes = 15;
  const shortEventMinutes = 30;
  const meaningfulGapMinutes = 10;
  const visualMergeWindowMinutes = 24;
  const maxVisibleIdentities = 4;
  const meaningfulInterruptionSeconds = 10 * 60;
  const mixedShareThreshold = 0.25;
  const mixedMinimumSeconds = 8 * 60;
  const standaloneEventSeconds = 5 * 60;
  type WeekCalendarSourceInterval = {
    startMinute: number;
    endMinute: number;
    category: ActivityCategory;
    productivity: ProductivityLabel;
    appName: string;
    identity: WeekCalendarIdentity;
    classificationSource: ClassificationSource;
    aiClassification: boolean;
    seconds: number;
    segmentId: string;
  };
  type WeekCalendarBucket = {
    startMinute: number;
    endMinute: number;
    intervals: readonly { readonly start: number; readonly end: number }[];
    sourceIntervals: WeekCalendarSourceInterval[];
  };
  type WeekCalendarBucketComponent = {
    coveredStartMinute: number;
    coveredEndMinute: number;
    categoryTotals: Map<ActivityCategory, number>;
    productivityTotals: Map<ProductivityLabel, number>;
    appTotals: Map<string, number>;
    identityTotals: Map<string, WeekCalendarEventIdentity>;
    sourceTotals: Map<ClassificationSource, number>;
    aiSeconds: number;
    segmentIds: Set<string>;
    totalSeconds: number;
    category: ActivityCategory;
    productivity: ProductivityLabel;
    classificationSource: ClassificationSource;
  };
  const bucketsByDay = new Map<string, WeekCalendarBucket[]>(days.map((day) => [day,
    buildLogicalDayDrawingBuckets(day, bucketMinutes, startOfDayMinutes)
      .filter((bucket) => bucket.startMinute >= minMinute && bucket.startMinute < maxMinute)
      .map((bucket) => ({
        startMinute: bucket.startMinute,
        endMinute: Math.min(maxMinute, bucket.endMinute),
        intervals: bucket.intervals,
        sourceIntervals: [],
      })),
  ]));

  function topEntry<K>(totals: Map<K, number>): [K, number] | null {
    return Array.from(totals.entries()).sort((left, right) => right[1] - left[1])[0] ?? null;
  }

  function isMeaningfulRemainder(totalSeconds: number, topSeconds: number): boolean {
    const remainderSeconds = totalSeconds - topSeconds;
    if (remainderSeconds >= meaningfulInterruptionSeconds) return true;
    return remainderSeconds >= mixedMinimumSeconds && totalSeconds > 0 && remainderSeconds / totalSeconds >= mixedShareThreshold;
  }

  function capturedSegmentLabel(count: number): string {
    return `${count} captured segment${count === 1 ? "" : "s"}`;
  }

  function topAppNamesLabel(topApps: Array<[string, number]>, fallbackLabel: string): string {
    const appNames = topApps.slice(0, 3).map(([appName]) => appName.trim()).filter(Boolean);
    return appNames.length > 0 ? appNames.join(", ") : fallbackLabel;
  }

  function weekCalendarSegmentLabel(segment: ActivitySegment): string {
    if (isExcludedSegment(segment)) {
      return "";
    }
    return segment.siteDomain?.trim() || segment.siteTitle?.trim() || segment.appName;
  }

  function weekCalendarSegmentIdentity(segment: ActivitySegment): WeekCalendarIdentity {
    if (isExcludedSegment(segment)) {
      return {
        id: "excluded",
        label: "",
        appName: "",
        bundleId: null,
        browserName: null,
        siteDomain: null,
        siteTitle: null,
        exclusionSource: segment.exclusionSource ?? "default",
      };
    }
    const appName = segment.appName.trim() || "Unknown app";
    const bundleId = segment.bundleId?.trim() || null;
    const browserName = segment.browserName?.trim() || null;
    const siteDomain = segment.siteDomain?.trim() || null;
    const siteTitle = segment.siteTitle?.trim() || null;
    const label = siteDomain ?? siteTitle ?? appName;
    const id = siteDomain
      ? `site:${siteDomain.toLowerCase()}`
      : siteTitle
        ? `site-title:${siteTitle.toLowerCase()}:${bundleId ?? appName}`
        : `app:${bundleId ?? appName}`;
    return { id, label, appName, bundleId, browserName, siteDomain, siteTitle };
  }

  function addIntervalToTotals(
    interval: WeekCalendarSourceInterval,
    categoryTotals: Map<ActivityCategory, number>,
    productivityTotals: Map<ProductivityLabel, number>,
    appTotals: Map<string, number>,
    identityTotals: Map<string, WeekCalendarEventIdentity>,
    sourceTotals: Map<ClassificationSource, number>,
    segmentIds: Set<string>,
  ): void {
    categoryTotals.set(interval.category, (categoryTotals.get(interval.category) ?? 0) + interval.seconds);
    productivityTotals.set(interval.productivity, (productivityTotals.get(interval.productivity) ?? 0) + interval.seconds);
    appTotals.set(interval.appName, (appTotals.get(interval.appName) ?? 0) + interval.seconds);
    const currentIdentity = identityTotals.get(interval.identity.id);
    if (currentIdentity) {
      currentIdentity.seconds += interval.seconds;
      currentIdentity.firstStartMinute = Math.min(currentIdentity.firstStartMinute, interval.startMinute);
      currentIdentity.sourceSegmentIds = [...new Set([...(currentIdentity.sourceSegmentIds ?? []), interval.segmentId])];
    } else {
      identityTotals.set(interval.identity.id, {
        ...interval.identity,
        seconds: interval.seconds,
        firstStartMinute: interval.startMinute,
        sourceSegmentIds: [interval.segmentId],
      });
    }
    sourceTotals.set(interval.classificationSource, (sourceTotals.get(interval.classificationSource) ?? 0) + interval.seconds);
    segmentIds.add(interval.segmentId);
  }

  function buildComponentFromIntervals(intervals: WeekCalendarSourceInterval[]): WeekCalendarBucketComponent | null {
    if (intervals.length === 0) return null;
    const categoryTotals = new Map<ActivityCategory, number>();
    const productivityTotals = new Map<ProductivityLabel, number>();
    const appTotals = new Map<string, number>();
    const identityTotals = new Map<string, WeekCalendarEventIdentity>();
    const sourceTotals = new Map<ClassificationSource, number>();
    const segmentIds = new Set<string>();
    let aiSeconds = 0;
    let totalSeconds = 0;
    let coveredStartMinute = intervals[0].startMinute;
    let coveredEndMinute = intervals[0].endMinute;

    for (const interval of intervals) {
      addIntervalToTotals(interval, categoryTotals, productivityTotals, appTotals, identityTotals, sourceTotals, segmentIds);
      totalSeconds += interval.seconds;
      if (interval.aiClassification) aiSeconds += interval.seconds;
      coveredStartMinute = Math.min(coveredStartMinute, interval.startMinute);
      coveredEndMinute = Math.max(coveredEndMinute, interval.endMinute);
    }

    const topCategory = topEntry(categoryTotals);
    if (!topCategory) return null;
    const topProductivity = topEntry(productivityTotals);
    const topSource = topEntry(sourceTotals);
    return {
      coveredStartMinute,
      coveredEndMinute,
      categoryTotals,
      productivityTotals,
      appTotals,
      identityTotals,
      sourceTotals,
      aiSeconds,
      segmentIds,
      totalSeconds,
      category: topCategory[0],
      productivity: topProductivity?.[0] ?? "neutral",
      classificationSource: topSource?.[0] ?? "unknown",
    };
  }

  function bucketComponents(bucket: WeekCalendarBucket): WeekCalendarBucketComponent[] {
    const sortedIntervals = bucket.sourceIntervals.slice().sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    const components: WeekCalendarBucketComponent[] = [];
    let currentIntervals: WeekCalendarSourceInterval[] = [];
    let currentCoveredEndMinute = 0;

    const flushComponent = () => {
      const component = buildComponentFromIntervals(currentIntervals);
      if (component) components.push(component);
      currentIntervals = [];
      currentCoveredEndMinute = 0;
    };

    for (const interval of sortedIntervals) {
      if (currentIntervals.length > 0 && interval.startMinute - currentCoveredEndMinute >= meaningfulGapMinutes) {
        flushComponent();
      }
      currentIntervals.push(interval);
      currentCoveredEndMinute = Math.max(currentCoveredEndMinute, interval.endMinute);
    }
    flushComponent();

    return components;
  }

  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const classification = classificationBySegmentId?.get(segment.id) ?? classifyActivityDetailed(segment, classificationOptions);
    const identity = weekCalendarSegmentIdentity(segment);
    for (const overlap of splitSegmentIntoDayOverlaps(segment, startDay, endDay, startOfDayMinutes, { sampledTime })) {
      const buckets = bucketsByDay.get(overlap.day);
      if (!buckets) continue;

      for (const bucket of buckets) {
        for (const bucketInterval of bucket.intervals) {
          const overlapStartMs = Math.max(overlap.startedAt.getTime(), bucketInterval.start);
          const overlapEndMs = Math.min(overlap.endedAt.getTime(), bucketInterval.end);
          if (overlapEndMs <= overlapStartMs) continue;
          const overlapSeconds = (sampledTime ? sampledActivitySecondsWithinInterval : activitySecondsWithinInterval)(segment, overlapStartMs, overlapEndMs);
          if (overlapSeconds <= 0) continue;
          let intervalStartMinute = Math.max(bucket.startMinute, Math.round(bucket.startMinute + (overlapStartMs - bucketInterval.start) / 60000));
          let intervalEndMinute = Math.min(bucket.endMinute, Math.round(bucket.startMinute + (overlapEndMs - bucketInterval.start) / 60000));
          if (intervalEndMinute <= intervalStartMinute) {
            // Sub-minute slice: keep it only when it carries enough activity to matter visually.
            if (overlapSeconds < 30) continue;
            intervalStartMinute = Math.min(Math.max(bucket.startMinute, intervalStartMinute), bucket.endMinute - 1);
            intervalEndMinute = intervalStartMinute + 1;
          }
          bucket.sourceIntervals.push({
            startMinute: intervalStartMinute,
            endMinute: intervalEndMinute,
            category: classification.category,
            productivity: classification.productivity,
            appName: weekCalendarSegmentLabel(segment),
            identity,
            classificationSource: classification.source,
            aiClassification: classification.source === "llm",
            seconds: overlapSeconds,
            segmentId: segment.id,
          });
        }
      }
    }
  }

  for (const [day, buckets] of bucketsByDay.entries()) {
    const dominantBuckets = buckets.flatMap(bucketComponents);
    let group: WeekCalendarBucketComponent[] = [];
    const groupCategorySeconds = new Map<ActivityCategory, number>();
    const groupProductivitySeconds = new Map<ProductivityLabel, number>();
    let groupTotalSeconds = 0;

    const flushGroup = () => {
      if (group.length === 0) return;
      const first = group[0];
      const startMinute = Math.min(...group.map((entry) => entry.coveredStartMinute));
      const endMinute = Math.max(...group.map((entry) => entry.coveredEndMinute));
      const totalSeconds = group.reduce((sum, entry) => sum + entry.totalSeconds, 0);
      const categoryTotals = new Map<ActivityCategory, number>();
      const appTotals = new Map<string, number>();
      const identityTotals = new Map<string, WeekCalendarEventIdentity>();
      const productivityTotals = new Map<ProductivityLabel, number>();
      const sourceTotals = new Map<ClassificationSource, number>();
      let aiSeconds = 0;
      const segmentIds = new Set<string>();
      for (const entry of group) {
        for (const [category, seconds] of entry.categoryTotals) categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + seconds);
        for (const [appName, seconds] of entry.appTotals) appTotals.set(appName, (appTotals.get(appName) ?? 0) + seconds);
        for (const [id, identityEntry] of entry.identityTotals) {
          const currentIdentity = identityTotals.get(id);
          if (currentIdentity) {
            currentIdentity.seconds += identityEntry.seconds;
            currentIdentity.firstStartMinute = Math.min(currentIdentity.firstStartMinute, identityEntry.firstStartMinute);
            currentIdentity.sourceSegmentIds = [...new Set([...(currentIdentity.sourceSegmentIds ?? []), ...(identityEntry.sourceSegmentIds ?? [])])];
          } else {
            identityTotals.set(id, { ...identityEntry });
          }
        }
        for (const [productivity, seconds] of entry.productivityTotals) productivityTotals.set(productivity, (productivityTotals.get(productivity) ?? 0) + seconds);
        for (const [source, seconds] of entry.sourceTotals) sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + seconds);
        aiSeconds += entry.aiSeconds;
        for (const segmentId of entry.segmentIds) segmentIds.add(segmentId);
      }
      const topApps = Array.from(appTotals.entries()).sort((left, right) => right[1] - left[1]);
      const orderedIdentities = Array.from(identityTotals.values()).sort((left, right) =>
        right.seconds - left.seconds || left.firstStartMinute - right.firstStartMinute || left.label.localeCompare(right.label),
      );
      const visibleIdentities = orderedIdentities.slice(0, maxVisibleIdentities);
      const topCategory = topEntry(categoryTotals);
      const dominantCategory = topCategory?.[0] ?? first.category;
      const topProductivity = topEntry(productivityTotals);
      const dominantProductivity = topProductivity?.[0] ?? first.productivity;
      const dominantSource = topEntry(sourceTotals)?.[0] ?? first.classificationSource ?? "unknown";
      const topApp = topApps[0] ?? null;
      const meaningfulMixedCategory = topCategory ? isMeaningfulRemainder(totalSeconds, topCategory[1]) : false;
      const meaningfulMixedProductivity = topProductivity ? isMeaningfulRemainder(totalSeconds, topProductivity[1]) : false;
      const meaningfulMixedApp = topApp ? isMeaningfulRemainder(totalSeconds, topApp[1]) : false;
      const isMixed = meaningfulMixedCategory || meaningfulMixedProductivity || meaningfulMixedApp;
      const startLabel = formatCalendarMinuteLabel(day, startMinute, startOfDayMinutes);
      const endLabel = formatCalendarMinuteLabel(day, endMinute, startOfDayMinutes);
      const categoryName = categoryLabel(dominantCategory);
      const topAppName = topApp?.[0] ?? categoryName;
      const sessionCount = segmentIds.size;
      const segmentLabel = capturedSegmentLabel(sessionCount);
      const detailSummary = isMixed ? segmentLabel : sessionCount <= 1 ? categoryName : segmentLabel;
      const displayAppName = isMixed ? topAppNamesLabel(topApps, topAppName || categoryName) : topAppName;
      const detailTitle = [
        `${startLabel}–${endLabel} · ${isMixed ? "Mixed activity" : categoryName}`,
        `${formatCompactDurationFromSeconds(totalSeconds)} across ${segmentLabel}`,
        ...topApps.slice(0, 3).map(([appName, seconds]) => `${appName} · ${formatCompactDurationFromSeconds(seconds)}`),
      ].join("\n");

      eventsByDay.get(day)!.push({
        id: `${day}-${dominantCategory}-${dominantProductivity}-${startMinute}-${endMinute}`,
        segmentIds: Array.from(segmentIds),
        appName: displayAppName,
        category: dominantCategory,
        productivity: dominantProductivity,
        startLabel,
        endLabel,
        detailSummary,
        detailTitle,
        sessionCount,
        identities: visibleIdentities,
        hiddenIdentityCount: Math.max(0, orderedIdentities.length - visibleIdentities.length),
        isGroupedCluster: group.length > 1 || orderedIdentities.length > 1,
        hasMixedCategory: categoryTotals.size > 1,
        hasMixedProductivity: productivityTotals.size > 1,
        classificationSource: dominantSource,
        aiClassification: aiSeconds > totalSeconds / 2,
        topMinutes: startMinute - minMinute,
        activeDurationMinutes: Math.max(1, Math.ceil(totalSeconds / 60)),
        durationMinutes: Math.max(1, endMinute - startMinute),
        isShort: endMinute - startMinute <= shortEventMinutes,
        lane: 0,
        laneCount: 1,
      });
      group = [];
      groupCategorySeconds.clear();
      groupProductivitySeconds.clear();
      groupTotalSeconds = 0;
    };

    const visuallyCollidesWithGroup = (entry: WeekCalendarBucketComponent): boolean => {
      if (group.length === 0) return false;
      const groupStartMinute = Math.min(...group.map((component) => component.coveredStartMinute));
      const groupEndMinute = Math.max(...group.map((component) => component.coveredEndMinute));
      const groupVisualEndMinute = groupStartMinute + Math.max(groupEndMinute - groupStartMinute, visualMergeWindowMinutes);
      return entry.coveredStartMinute < groupVisualEndMinute;
    };

    for (const entry of dominantBuckets) {
      if (group.length > 0) {
        const previous = group[group.length - 1];
        const hasMeaningfulGap = entry.coveredStartMinute - previous.coveredEndMinute >= meaningfulGapMinutes;
        // Compare against the group's accumulated dominant, not just the previous component,
        // so brief classification flaps don't flip the boundary decision.
        const groupCategory = topEntry(groupCategorySeconds)?.[0] ?? previous.category;
        const groupProductivity = topEntry(groupProductivitySeconds)?.[0] ?? previous.productivity;
        const categoryChanged = groupCategory !== entry.category;
        const productivityChanged = groupProductivity !== entry.productivity;
        // Both sides are substantial enough to render as separate blocks.
        const canStandAlone = groupTotalSeconds >= standaloneEventSeconds && entry.totalSeconds >= standaloneEventSeconds;
        const softBreak = (hasMeaningfulGap || categoryChanged || productivityChanged) && !visuallyCollidesWithGroup(entry);
        const hardBreak = (hasMeaningfulGap || categoryChanged) && canStandAlone;
        if (softBreak || hardBreak) flushGroup();
      }
      group.push(entry);
      for (const [category, seconds] of entry.categoryTotals) groupCategorySeconds.set(category, (groupCategorySeconds.get(category) ?? 0) + seconds);
      for (const [productivity, seconds] of entry.productivityTotals) groupProductivitySeconds.set(productivity, (groupProductivitySeconds.get(productivity) ?? 0) + seconds);
      groupTotalSeconds += entry.totalSeconds;
    }
    flushGroup();
  }

  for (const events of eventsByDay.values()) {
    events.sort((left, right) => left.topMinutes - right.topMinutes || right.durationMinutes - left.durationMinutes);
  }

  return eventsByDay;
}

export function assignWeekCalendarEventLanes(events: WeekCalendarEvent[], durationMinutes: (event: WeekCalendarEvent) => number = event => event.durationMinutes): void {
  let cluster: WeekCalendarEvent[] = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const event of cluster) {
      const lane = laneEnds.findIndex((end) => end <= event.topMinutes);
      const assignedLane = lane === -1 ? laneEnds.length : lane;
      event.lane = assignedLane;
      laneEnds[assignedLane] = event.topMinutes + durationMinutes(event);
    }
    for (const event of cluster) event.laneCount = laneEnds.length;
    cluster = [];
  };

  for (const event of events) {
    const eventEnd = event.topMinutes + durationMinutes(event);
    if (cluster.length > 0 && event.topMinutes >= clusterEnd) flushCluster();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, eventEnd);
  }
  flushCluster();
}

export function getCalendarWeekStartDay(selectedDay: string, startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK): string {
  const selectedWeekday = new Date(`${selectedDay}T12:00:00`).getDay();
  const weekStarts: Record<StartOfWeek, number> = { sunday: 0, monday: 1, saturday: 6 };
  const startWeekday = weekStarts[startOfWeek];
  const offset = (selectedWeekday - startWeekday + 7) % 7;
  return shiftIsoDate(selectedDay, -offset);
}
