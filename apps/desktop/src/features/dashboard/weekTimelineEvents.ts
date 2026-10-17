import {
  activityBlockLabelKey, activitySecondsWithinInterval, activityTimeBounds, aggregateDeviceElapsedTime,
  classifyActivityDetailed, isExcludedSegment, logicalDayEndExclusiveMs, logicalDayStartMs,
  type ActivitySegment, type ClassificationOptions, type StoredActivityTimelineCard,
} from "@drifty/domain";
import { formatCalendarMinuteLabel } from "../../lib/formatting";
import type { WeekCalendarEvent, WeekCalendarEventIdentity, WeekSegmentClassification } from "./weekCalendar";
import { WEEK_CARD_MERGE_GAP_MINUTES } from "./weekCardBlocks";

type Range = { readonly start: number; readonly end: number };
type Options = {
  readonly startOfDayMinutes: number;
  readonly classificationOptions?: ClassificationOptions;
  readonly classificationBySegmentId?: ReadonlyMap<string, WeekSegmentClassification>;
};

function add<K>(totals: Map<K, number>, key: K, seconds: number) {
  totals.set(key, (totals.get(key) ?? 0) + seconds);
}
function dominant<K>(totals: Map<K, number>): K {
  return [...totals].sort((a, b) => b[1] - a[1])[0][0];
}

/** A card never bridges a captured-record break longer than B permits. */
export function splitWeekTimelineRanges(ranges: readonly Range[]): Range[] {
  const out: Range[] = [];
  for (const range of [...ranges].filter(r => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out[out.length - 1];
    if (last && range.start - last.end <= WEEK_CARD_MERGE_GAP_MINUTES * 60_000) {
      out[out.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else out.push(range);
  }
  return out;
}

function subtract(range: Range, cuts: readonly Range[]): Range[] {
  let remaining = [range];
  for (const cut of cuts) {
    remaining = remaining.flatMap(r => cut.end <= r.start || cut.start >= r.end ? [r] : [
      { start: r.start, end: Math.min(r.end, cut.start) },
      { start: Math.max(r.start, cut.end), end: r.end },
    ].filter(r => r.end > r.start));
  }
  return remaining;
}

function rangeEvent(day: string, range: Range, segments: readonly ActivitySegment[], options: Options, cardKey?: string): WeekCalendarEvent | null {
  const dayStart = logicalDayStartMs(day, options.startOfDayMinutes);
  const categories = new Map<WeekCalendarEvent["category"], number>();
  const productivity = new Map<WeekCalendarEvent["productivity"], number>();
  const sources = new Map<WeekCalendarEvent["classificationSource"], number>();
  const identities = new Map<string, WeekCalendarEventIdentity>();
  const segmentIds: string[] = [];
  let total = 0, aiSeconds = 0;
  for (const segment of segments) {
    const seconds = activitySecondsWithinInterval(segment, range.start, range.end);
    if (!(seconds > 0)) continue;
    const classification = options.classificationBySegmentId?.get(segment.id) ?? classifyActivityDetailed(segment, options.classificationOptions);
    add(categories, classification.category, seconds);
    add(productivity, classification.productivity, seconds);
    add(sources, classification.source, seconds);
    total += seconds;
    if (classification.source === "llm") aiSeconds += seconds;
    segmentIds.push(segment.id);
    const excluded = isExcludedSegment(segment);
    const appName = excluded ? "" : segment.appName.trim() || "Unknown app";
    const bundleId = excluded ? null : segment.bundleId?.trim() || null;
    const browserName = excluded ? null : segment.browserName?.trim() || null;
    const siteDomain = excluded ? null : segment.siteDomain?.trim() || null;
    const siteTitle = excluded ? null : segment.siteTitle?.trim() || null;
    const id = excluded ? "excluded" : siteDomain ? `site:${siteDomain.toLowerCase()}`
      : siteTitle ? `site-title:${siteTitle.toLowerCase()}:${bundleId ?? appName}` : `app:${bundleId ?? appName}`;
    const firstStartMinute = (Math.max(range.start, activityTimeBounds(segment).start) - dayStart) / 60_000;
    const known = identities.get(id);
    identities.set(id, known ? {
      ...known, seconds: known.seconds + seconds, firstStartMinute: Math.min(known.firstStartMinute, firstStartMinute),
      sourceSegmentIds: [...new Set([...(known.sourceSegmentIds ?? []), segment.id])],
    } : {
      id, label: siteDomain ?? siteTitle ?? appName, appName, bundleId, browserName, siteDomain, siteTitle,
      seconds, firstStartMinute, sourceSegmentIds: [segment.id], ...(excluded ? { exclusionSource: segment.exclusionSource ?? "default" } : {}),
    });
  }
  if (!(total > 0)) return null;
  const ordered = [...identities.values()].sort((a, b) => b.seconds - a.seconds || a.firstStartMinute - b.firstStartMinute || a.id.localeCompare(b.id));
  const category = dominant(categories), prod = dominant(productivity);
  const topMinutes = (range.start - dayStart) / 60_000, durationMinutes = (range.end - range.start) / 60_000;
  // A long record may cross two cards. Its IDs alone cannot identify a hide
  // choice; range keys survive a title regeneration without naming another slice.
  const activityLabelKey = `${activityBlockLabelKey(day, segmentIds)}:${range.start}:${range.end}`;
  return {
    id: `timeline:${activityLabelKey}`, activityLabelKey, timelineCardKey: cardKey,
    segmentIds: [...new Set(segmentIds)], appName: ordered[0].appName, category, productivity: prod,
    startLabel: formatCalendarMinuteLabel(day, topMinutes, options.startOfDayMinutes),
    endLabel: formatCalendarMinuteLabel(day, topMinutes + durationMinutes, options.startOfDayMinutes),
    detailSummary: ordered.slice(0, 3).map(identity => identity.label).join(" · "), detailTitle: ordered[0].label,
    sessionCount: new Set(segmentIds).size, identities: ordered.slice(0, 4), hiddenIdentityCount: Math.max(0, ordered.length - 4),
    isGroupedCluster: false, hasMixedCategory: categories.size > 1, hasMixedProductivity: productivity.size > 1,
    classificationSource: dominant(sources), aiClassification: aiSeconds > total / 2,
    topMinutes, durationMinutes, activeDurationMinutes: total / 60, isShort: durationMinutes < 30, lane: 0, laneCount: 1,
  };
}

/**
 * Build from stored card boundaries, then let the unchanged B arranger fold
 * short pieces. Unnamed ranges retain the existing calendar, not invented cards.
 * This is display geometry only; records, generation and totals stay intact.
 */
export function buildWeekTimelineEvents(
  legacy: ReadonlyMap<string, readonly WeekCalendarEvent[]>,
  segments: readonly ActivitySegment[],
  cards: readonly StoredActivityTimelineCard[],
  options: Options,
): Map<string, WeekCalendarEvent[]> {
  const projected = aggregateDeviceElapsedTime(segments);
  return new Map([...legacy].map(([day, old]) => {
    const dayStart = logicalDayStartMs(day, options.startOfDayMinutes), dayEnd = logicalDayEndExclusiveMs(day, options.startOfDayMinutes);
    // The existing fixed clock axis folds repeated DST hours. Preserve that
    // representation on clock-change days rather than drawing elapsed minutes
    // past 24h or assigning the repeated hour to the wrong card.
    if (dayEnd - dayStart !== 86_400_000) return [day, [...old]];
    const dayCards = cards.filter(c => c.record.logicalDay === day && c.startMs < dayEnd && c.endMs > dayStart);
    if (dayCards.length === 0) return [day, [...old]];
    const daySegments = projected.filter(s => { const time = activityTimeBounds(s); return time.start < dayEnd && time.end > dayStart; });
    const events: WeekCalendarEvent[] = [], covered: Range[] = [];
    for (const card of dayCards) {
      // Conflicting stored boundaries cannot establish a unique card. Leave
      // those ranges on the legacy display rather than arbitrarily picking one.
      if (dayCards.some(other => other !== card && other.startMs < card.endMs && other.endMs > card.startMs)) continue;
      const ids = new Set(card.record.segmentIds);
      const own = daySegments.filter(s => ids.has(s.id) && !isExcludedSegment(s));
      const ranges = own.map(s => { const time = activityTimeBounds(s); return { start: Math.max(card.startMs, dayStart, time.start), end: Math.min(card.endMs, dayEnd, time.end) }; });
      for (const range of splitWeekTimelineRanges(ranges)) {
        const event = rangeEvent(day, range, own, options, card.record.blockKey);
        if (event) { events.push(event); covered.push(range); }
      }
    }
    for (const event of old) {
      const range = { start: dayStart + event.topMinutes * 60_000, end: dayStart + (event.topMinutes + event.durationMinutes) * 60_000 };
      if (!covered.some(c => c.start < range.end && c.end > range.start)) { events.push(event); continue; }
      const ids = new Set(event.segmentIds), own = daySegments.filter(s => ids.has(s.id));
      for (const rest of subtract(range, covered)) {
        const fallback = rangeEvent(day, rest, own, options);
        if (fallback) events.push(fallback);
      }
    }
    return [day, events.sort((a, b) => a.topMinutes - b.topMinutes || a.id.localeCompare(b.id))];
  }));
}
