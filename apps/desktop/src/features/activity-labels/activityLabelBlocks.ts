import {
  ACTIVITY_BLOCK_LABEL_MIN_BLOCK_SECONDS,
  ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
  activityBlockLabelKey,
  storedActivityTimelineCards,
  type StoredActivityTimelineCard,
  activitySecondsWithinInterval,
  displayedActivityBlockLabel,
  logicalDayStartMs,
  resolveActivityBlockLabel,
  type ActivityBlockLabelLanguage,
  type ActivityBlockLabelRecord,
  type ActivityBlockLabelResolution,
  type ActivityTimelineWindowRecord,
  type ActivitySegment,
} from "@drifty/domain";

/** A block must be finished this long before its label is generated. */
export const ACTIVITY_LABEL_SETTLE_MS = 10 * 60 * 1000;

/** The canonical (category-mode) block shape the week model produces. */
export type ActivityLabelSourceEvent = {
  readonly activityLabelKey?: string;
  readonly timelineCardKey?: string;
  readonly segmentIds: readonly string[];
  readonly topMinutes: number;
  readonly durationMinutes: number;
};

/**
 * "candidate": finished, long enough and without a stored answer. Whether its
 * titles are enough is decided at generation time from the full records,
 * because the Week view loads a compact payload without window titles.
 */
export type ActivityLabelGeneration = "candidate" | "short" | "live" | "resolved";

export type ActivityLabelDisplay = NonNullable<ReturnType<typeof displayedActivityBlockLabel>>;

/** Another timeline card inside the same block (Day view lists them). */
export type ActivityLabelOtherCard = {
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
};

/** The timeline card a block belongs to, kept whatever the user chose for its name. */
export type ActivityLabelBlockCard = ActivityLabelOtherCard & { readonly key: string };

export type ActivityLabelBlock = {
  readonly key: string;
  readonly day: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly segmentIds: readonly string[];
  readonly recordedSeconds: number;
  readonly resolution: ActivityBlockLabelResolution;
  readonly display: ActivityLabelDisplay | null;
  /** The card covering most of the block (at least 30%), even when the user
   *  hid its name; the Week view groups blocks by it. */
  readonly card: ActivityLabelBlockCard | null;
  /** Further cards that hold a real part of this block, in time order. */
  readonly otherCards: readonly ActivityLabelOtherCard[];
  readonly generation: ActivityLabelGeneration;
};

/** A card names a block when it covers this share of the block's time. */
const CARD_MIN_BLOCK_SHARE = 0.3;
/** Other cards are listed when they cover this share, and at least five minutes. */
const OTHER_CARD_MIN_SHARE = 0.15;
const OTHER_CARD_MIN_MS = 5 * 60_000;

function cardsForBlock(cards: readonly StoredActivityTimelineCard[], startMs: number, endMs: number) {
  const span = Math.max(1, endMs - startMs);
  return cards
    .map((card) => ({ card, overlap: Math.min(endMs, card.endMs) - Math.max(startMs, card.startMs) }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.card.startMs - b.card.startMs)
    .filter((entry, index) => index === 0 ? entry.overlap >= span * CARD_MIN_BLOCK_SHARE : entry.overlap >= Math.max(OTHER_CARD_MIN_MS, span * OTHER_CARD_MIN_SHARE));
}

export type ActivityLabelBlockOptions = {
  readonly startOfDayMinutes: number;
  readonly segmentsById: ReadonlyMap<string, ActivitySegment>;
  /** The user's choices per block (hide a name). */
  readonly labels: readonly ActivityBlockLabelRecord[];
  /** Described windows with their cards. */
  readonly windows: readonly ActivityTimelineWindowRecord[];
  readonly language: ActivityBlockLabelLanguage;
  readonly nowMs: number;
};

/**
 * One entry per canonical block. Labels are attached here, by the records a
 * block contains, never by a rendered element id.
 */
export function buildActivityLabelBlocks(
  eventsByDay: ReadonlyMap<string, readonly ActivityLabelSourceEvent[]>,
  options: ActivityLabelBlockOptions,
): ActivityLabelBlock[] {
  const labelsByDay = new Map<string, ActivityBlockLabelRecord[]>();
  const cards = storedActivityTimelineCards(options.windows, options.language);
  for (const label of options.labels) {
    const list = labelsByDay.get(label.logicalDay) ?? [];
    list.push(label);
    labelsByDay.set(label.logicalDay, list);
  }
  const blocks: ActivityLabelBlock[] = [];
  for (const [day, events] of eventsByDay) {
    const dayStartMs = logicalDayStartMs(day, options.startOfDayMinutes);
    const dayLabels = labelsByDay.get(day) ?? [];
    for (const event of events) {
      const segmentIds = [...new Set(event.segmentIds)];
      if (segmentIds.length === 0) continue;
      const startMs = dayStartMs + event.topMinutes * 60_000;
      const durationMinutes = Math.max(event.activityLabelKey ? 0.000001 : 1, event.durationMinutes);
      const endMs = startMs + durationMinutes * 60_000;
      const key = event.activityLabelKey ?? activityBlockLabelKey(day, segmentIds);
      const segmentSeconds = new Map<string, number>();
      for (const id of segmentIds) {
        const segment = options.segmentsById.get(id);
        if (segment) segmentSeconds.set(id, activitySecondsWithinInterval(segment, startMs, endMs));
      }
      const recordedSeconds = [...segmentSeconds.values()].reduce((sum, seconds) => sum + seconds, 0);
      // A user's choice for the block wins; otherwise the timeline card that
      // covers most of the block names it. Block-level AI rows from the
      // earlier prompt are ignored by asking for the card prompt version.
      // Range-specific choices must not leak along a record that crosses two
      // cards. Legacy choices can still cover all the slices they used to hide.
      const choices = dayLabels.filter(label => {
        const from = Date.parse(label.blockStartedAt), to = Date.parse(label.blockEndedAt);
        if (label.blockKey === key || !Number.isFinite(from) || !Number.isFinite(to)) return true;
        if (!(from < endMs && to > startMs)) return false;
        if (label.source !== "user" || recordedSeconds <= 0) return true;
        const shared = new Set(label.segmentIds);
        const seconds = segmentIds.reduce((sum, id) => {
          const segment = shared.has(id) ? options.segmentsById.get(id) : undefined;
          return sum + (segment ? activitySecondsWithinInterval(segment, Math.max(from, startMs), Math.min(to, endMs)) : 0);
        }, 0);
        return seconds >= recordedSeconds * 0.6;
      });
      let resolution = resolveActivityBlockLabel({
        blockKey: key,
        language: options.language,
        promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
        segmentSeconds,
        labels: choices,
      });
      if (resolution.kind === "none" && event.activityLabelKey && recordedSeconds > 0) {
        const hidden = choices.find(label => {
          if (label.source !== "user" || (label.status !== "hidden" && label.title.trim())) return false;
          const from = Date.parse(label.blockStartedAt), to = Date.parse(label.blockEndedAt);
          if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
          const shared = new Set(label.segmentIds);
          const seconds = segmentIds.reduce((sum, id) => {
            const segment = shared.has(id) ? options.segmentsById.get(id) : undefined;
            return sum + (segment ? activitySecondsWithinInterval(segment, Math.max(from, startMs), Math.min(to, endMs)) : 0);
          }, 0);
          return seconds >= recordedSeconds * 0.6;
        });
        if (hidden) resolution = { kind: "user", record: hidden, carried: true };
      }
      const covering = event.activityLabelKey
        ? cards.filter(card => card.record.blockKey === event.timelineCardKey).map(card => ({ card, overlap: endMs - startMs }))
        : cardsForBlock(cards, startMs, endMs);
      const matched = resolution.kind === "none" ? covering : [];
      if (matched.length > 0) resolution = { kind: "ai", record: matched[0].card.record };
      const generation: ActivityLabelGeneration = resolution.kind !== "none"
        ? "resolved"
        : recordedSeconds < ACTIVITY_BLOCK_LABEL_MIN_BLOCK_SECONDS
          ? "short"
          : endMs > options.nowMs - ACTIVITY_LABEL_SETTLE_MS
            ? "live"
            : "candidate";
      blocks.push({
        key,
        day,
        startMs,
        endMs,
        startMinute: event.topMinutes,
        endMinute: event.topMinutes + durationMinutes,
        segmentIds,
        recordedSeconds,
        resolution,
        display: displayedActivityBlockLabel(resolution),
        card: covering[0]
          ? { key: covering[0].card.record.blockKey, title: covering[0].card.record.title, startMs: covering[0].card.startMs, endMs: covering[0].card.endMs }
          : null,
        otherCards: matched.slice(1, 3)
          .map((entry) => ({ title: entry.card.record.title, startMs: entry.card.startMs, endMs: entry.card.endMs }))
          .sort((a, b) => a.startMs - b.startMs),
        generation,
      });
    }
  }
  return blocks;
}

export type ActivityLabelIndex = {
  /** Exact canonical block, or a near-identical slice of one (project color mode). */
  readonly forSegments: (day: string, segmentIds: readonly string[], range?: Pick<ActivityLabelSourceEvent, "topMinutes" | "durationMinutes">) => ActivityLabelBlock | null;
  /** The block that holds most of a Day-view hover range. */
  readonly forRange: (day: string, startMinute: number, endMinute: number, segmentIds: readonly string[]) => ActivityLabelBlock | null;
};

const SLICE_MATCH_SHARE = 0.8;
const RANGE_MATCH_SHARE = 0.5;

export function buildActivityLabelIndex(
  blocks: readonly ActivityLabelBlock[],
  segmentsById: ReadonlyMap<string, ActivitySegment>,
): ActivityLabelIndex {
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const byDay = new Map<string, ActivityLabelBlock[]>();
  for (const block of blocks) {
    const list = byDay.get(block.day) ?? [];
    list.push(block);
    byDay.set(block.day, list);
  }
  const forWeekRange = (day: string, startMinute: number, endMinute: number, segmentIds: readonly string[]) => {
    const ids = new Set(segmentIds);
    let best: { block: ActivityLabelBlock; score: number } | null = null;
    for (const block of byDay.get(day) ?? []) {
      const overlap = Math.min(endMinute, block.endMinute) - Math.max(startMinute, block.startMinute);
      if (overlap <= 0) continue;
      const shared = ids.size > 0 ? block.segmentIds.filter(id => ids.has(id)).length / ids.size : 0;
      if (shared < RANGE_MATCH_SHARE) continue;
      const score = shared + overlap / Math.max(0.000001, endMinute - startMinute);
      if (!best || score > best.score) best = { block, score };
    }
    return best?.block ?? null;
  };
  return {
    forSegments(day, segmentIds, range) {
      if (range) return forWeekRange(day, range.topMinutes, range.topMinutes + range.durationMinutes, segmentIds);
      const exact = byKey.get(activityBlockLabelKey(day, segmentIds));
      if (exact) return exact;
      const ids = new Set(segmentIds);
      if (ids.size === 0) return null;
      let best: { block: ActivityLabelBlock; score: number } | null = null;
      for (const block of byDay.get(day) ?? []) {
        const shared = block.segmentIds.filter((id) => ids.has(id)).length;
        const sliceShare = shared / ids.size;
        const blockShare = shared / block.segmentIds.length;
        if (sliceShare < SLICE_MATCH_SHARE || blockShare < SLICE_MATCH_SHARE) continue;
        const score = sliceShare + blockShare;
        if (!best || score > best.score) best = { block, score };
      }
      return best?.block ?? null;
    },
    forRange(day, startMinute, endMinute, segmentIds) {
      const dayBlocks = byDay.get(day) ?? [];
      if (dayBlocks.length === 0 || endMinute <= startMinute) return null;
      const dayStartMs = dayBlocks[0].startMs - dayBlocks[0].startMinute * 60_000;
      const startMs = dayStartMs + startMinute * 60_000;
      const endMs = dayStartMs + endMinute * 60_000;
      const ids = new Set(segmentIds);
      const secondsWithin = (recordIds: Iterable<string>, from: number, to: number) => {
        if (to <= from) return 0;
        let seconds = 0;
        for (const id of recordIds) {
          const segment = ids.has(id) ? segmentsById.get(id) : undefined;
          if (segment) seconds += activitySecondsWithinInterval(segment, from, to);
        }
        return seconds;
      };
      // A continuous Day hover can contain many card-sized Week blocks. Rank
      // their shared recorded time, not their share of record IDs: frequent
      // short captures must not outweigh a longer task (or hide every card).
      const candidates = dayBlocks.map(block => ({
        block,
        seconds: secondsWithin(block.segmentIds, Math.max(startMs, block.startMs), Math.min(endMs, block.endMs)),
      })).filter(candidate => candidate.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds || a.block.startMs - b.block.startMs);
      const block = candidates[0]?.block;
      if (!block) return null;
      // Choose before checking display, so a hidden dominant task cannot be
      // replaced by a visible runner-up.
      const others = new Map(block.otherCards.map(card => [card.startMs + ":" + card.title, card]));
      const otherSeconds = new Map<string, { card: ActivityLabelBlockCard; seconds: number }>();
      for (const candidate of candidates) {
        const other = candidate.block;
        if (!other.card || other.card.key === block.card?.key || !other.display) continue;
        const previous = otherSeconds.get(other.card.key);
        otherSeconds.set(other.card.key, { card: other.card, seconds: (previous?.seconds ?? 0) + candidate.seconds });
      }
      const minimumSeconds = Math.max(OTHER_CARD_MIN_MS / 1000, secondsWithin(ids, startMs, endMs) * OTHER_CARD_MIN_SHARE);
      for (const { card, seconds } of otherSeconds.values()) {
        if (seconds >= minimumSeconds) others.set(card.startMs + ":" + card.title, card);
      }
      return { ...block, otherCards: [...others.values()].sort((a, b) => a.startMs - b.startMs).slice(0, 3) };
    },
  };
}

