import { logicalDayStartMs } from "@drifty/domain";
import type { ActivityInspectorLabel } from "../activity-labels/activityInspectorLabel";
import type { ActivityLabelBlock, ActivityLabelBlockCard, ActivityLabelIndex, ActivityLabelOtherCard } from "../activity-labels/activityLabelBlocks";
import type { WeekCalendarEvent } from "./weekCalendar";

/**
 * Week blocks with timeline cards (product decision "Week blocks with timeline
 * cards", 2026-10-16). Dayflow keeps no card under 10 minutes and folds a short
 * side activity into the neighbouring card; the Week view does the same with
 * the blocks it already has:
 *
 * - Consecutive blocks of one card are drawn as one block when the break
 *   between them is at most 10 minutes; a longer break starts a new block
 *   that names the card again.
 * - A short piece of something else inside the card's time joins that block.
 *   Short means under 14 minutes, or at most 4 recorded minutes, which the
 *   default axis draws as a bare line (weekCalendarEventLayout micro blocks).
 * - A short block that touches a neighbour (2 minutes or less) folds into it,
 *   the same card first, then the longer one; one that touches nothing is not
 *   drawn.
 * - A merged block keeps the category, productivity and leading app of its own
 *   card's blocks; folded pieces add only their time and apps, and its card
 *   lists their cards with their start time.
 */
export const WEEK_CARD_SHORT_BLOCK_MINUTES = 14;
export const WEEK_CARD_LINE_ACTIVE_MINUTES = 4;
export const WEEK_CARD_TOUCH_GAP_MINUTES = 2;
export const WEEK_CARD_MERGE_GAP_MINUTES = 10;

/** Owner decision 2026-10-16: a block shows its icon and name together
 *  wherever both fit whole, and its colour alone otherwise; a long name ends
 *  in an ellipsis. This is the smallest visible block height (px) that holds
 *  the 11.7px icon and one 0.66rem name line inside its 1px borders, 14px at
 *  the default root size (the name line grows with the root font size). */
export function weekWorkNameMinHeight(rootFontSizePx: number): number {
  const rem = Number.isFinite(rootFontSizePx) && rootFontSizePx > 0 ? rootFontSizePx : 16;
  return Math.max(14, 1 + Math.max(11.7, 0.66 * 1.12 * rem) + 1);
}

export type WeekCardBlockName = {
  /** What the block's hover and pinned card show; null keeps the app/site text. */
  readonly label: ActivityInspectorLabel | null;
};

export type WeekCardBlocks = {
  readonly eventsByDay: Map<string, WeekCalendarEvent[]>;
  readonly names: ReadonlyMap<string, WeekCardBlockName>;
  /** Blocks drawn for more than one source block; their time labels are rebuilt by the view. */
  readonly mergedIds: ReadonlySet<string>;
};

export type WeekCardBlockOptions = {
  readonly startOfDayMinutes: number;
  /** A record the view was asked to show (History): its block is always drawn. */
  readonly keepSegmentId?: string | null;
};

type Entry = { readonly event: WeekCalendarEvent; readonly block: ActivityLabelBlock | null; readonly card: ActivityLabelBlockCard | null };
type Group = { readonly card: ActivityLabelBlockCard | null; readonly entries: Entry[]; readonly folded: ActivityLabelBlockCard[] };

const end = (event: WeekCalendarEvent) => event.topMinutes + event.durationMinutes;
const groupStart = (group: Group) => Math.min(...group.entries.map((entry) => entry.event.topMinutes));
const groupEnd = (group: Group) => Math.max(...group.entries.map((entry) => end(entry.event)));
const groupSpan = (group: Group) => groupEnd(group) - groupStart(group);
const isShortEvent = (event: WeekCalendarEvent) => event.durationMinutes < WEEK_CARD_SHORT_BLOCK_MINUTES || event.activeDurationMinutes <= WEEK_CARD_LINE_ACTIVE_MINUTES;
const isShortGroup = (group: Group) => groupSpan(group) < WEEK_CARD_SHORT_BLOCK_MINUTES
  || group.entries.reduce((sum, entry) => sum + entry.event.activeDurationMinutes, 0) <= WEEK_CARD_LINE_ACTIVE_MINUTES;
const sameCard = (a: ActivityLabelBlockCard | null, b: ActivityLabelBlockCard | null) => Boolean(a && b && a.key === b.key);

function dominantBy<T>(items: readonly T[], key: (item: T) => string, weight: (item: T) => number): string {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? 0) + weight(item));
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function sumIdentities(list: readonly WeekCalendarEvent[]): WeekCalendarEvent["identities"] {
  const byId = new Map<string, WeekCalendarEvent["identities"][number]>();
  for (const identity of list.flatMap((event) => event.identities)) {
    const known = byId.get(identity.id);
    byId.set(identity.id, known
      ? {
        ...known,
        seconds: known.seconds + identity.seconds,
        firstStartMinute: Math.min(known.firstStartMinute, identity.firstStartMinute),
        sourceSegmentIds: [...new Set([...(known.sourceSegmentIds ?? []), ...(identity.sourceSegmentIds ?? [])])],
      }
      : identity);
  }
  return [...byId.values()].sort((a, b) => b.seconds - a.seconds || a.firstStartMinute - b.firstStartMinute);
}

/** `core` (the card's own blocks) decides category, productivity and the
 *  leading app; `extra` (folded or joined pieces) adds its time and apps. */
function mergeEvents(core: readonly WeekCalendarEvent[], extra: readonly WeekCalendarEvent[]): WeekCalendarEvent {
  const list = [...core, ...extra].sort((a, b) => a.topMinutes - b.topMinutes);
  const base = [...core].sort((a, b) => b.activeDurationMinutes - a.activeDurationMinutes)[0];
  const topMinutes = Math.min(...list.map((event) => event.topMinutes));
  const endMinutes = Math.max(...list.map(end));
  const category = dominantBy(core, (event) => event.category, (event) => event.activeDurationMinutes) as WeekCalendarEvent["category"];
  const productivity = dominantBy(core, (event) => event.productivity, (event) => event.activeDurationMinutes) as WeekCalendarEvent["productivity"];
  const coreIdentities = sumIdentities(core);
  const allIdentities = sumIdentities(list);
  const coreIds = new Set(coreIdentities.map((identity) => identity.id));
  return {
    ...base,
    id: "card:" + list.map((event) => event.id).join("+"),
    segmentIds: [...new Set(list.flatMap((event) => event.segmentIds))],
    category,
    productivity,
    identities: [
      ...coreIdentities.map((identity) => allIdentities.find((entry) => entry.id === identity.id) ?? identity),
      ...allIdentities.filter((identity) => !coreIds.has(identity.id)),
    ],
    hiddenIdentityCount: list.reduce((sum, event) => sum + event.hiddenIdentityCount, 0),
    topMinutes,
    durationMinutes: endMinutes - topMinutes,
    activeDurationMinutes: list.reduce((sum, event) => sum + event.activeDurationMinutes, 0),
    sessionCount: new Set(list.flatMap((event) => event.segmentIds)).size,
    hasMixedCategory: list.some((event) => event.hasMixedCategory || event.category !== category),
    hasMixedProductivity: list.some((event) => event.hasMixedProductivity || event.productivity !== productivity),
    isGroupedCluster: false,
    isShort: false,
    lane: 0,
    laneCount: 1,
  };
}

function mergedLabel(group: Group, core: readonly Entry[], extra: readonly Entry[]): ActivityInspectorLabel | null {
  const host = [...core].sort((a, b) => b.event.activeDurationMinutes - a.event.activeDurationMinutes)[0]?.block ?? null;
  if (!host) return null;
  const members = [...new Map(core.flatMap((entry) => entry.block ? [[entry.block.key, entry.block] as const] : [])).values()];
  const others = new Map<string, ActivityLabelOtherCard>();
  const add = (card: ActivityLabelOtherCard) => {
    if (group.card && card.title === group.card.title && card.startMs === group.card.startMs) return;
    others.set(card.startMs + ":" + card.title, card);
  };
  for (const member of members) member.otherCards.forEach(add);
  for (const entry of extra) if (entry.card && !sameCard(entry.card, group.card)) add(entry.card);
  group.folded.forEach(add);
  return {
    block: { ...host, otherCards: [...others.values()].sort((a, b) => a.startMs - b.startMs).slice(0, 3) },
    display: host.display,
    scope: "block",
    members,
  };
}

function arrangeDay(day: string, events: readonly WeekCalendarEvent[], index: ActivityLabelIndex, options: WeekCardBlockOptions) {
  const dayStartMs = logicalDayStartMs(day, options.startOfDayMinutes);
  const insideCard = (event: WeekCalendarEvent, card: ActivityLabelBlockCard) => (
    dayStartMs + event.topMinutes * 60_000 >= card.startMs - 60_000 && dayStartMs + end(event) * 60_000 <= card.endMs + 60_000
  );
  const sorted = [...events].sort((a, b) => a.topMinutes - b.topMinutes || b.durationMinutes - a.durationMinutes);
  const groups: Group[] = [];
  for (const event of sorted) {
    const block = index.forSegments(day, event.segmentIds);
    const entry: Entry = { event, block, card: block?.card ?? null };
    const last = groups[groups.length - 1];
    if (last && event.topMinutes - groupEnd(last) <= WEEK_CARD_MERGE_GAP_MINUTES) {
      const joins = sameCard(last.card, entry.card)
        || Boolean(last.card && isShortEvent(event) && insideCard(event, last.card));
      if (joins) {
        last.entries.push(entry);
        continue;
      }
    }
    groups.push({ card: entry.card, entries: [entry], folded: [] });
  }

  const keeps = (group: Group) => Boolean(options.keepSegmentId && group.entries.some((entry) => entry.event.segmentIds.includes(options.keepSegmentId!)));
  let position = 0;
  while (position < groups.length) {
    const group = groups[position];
    if (!isShortGroup(group)) { position += 1; continue; }
    const previous = position > 0 && groupStart(group) - groupEnd(groups[position - 1]) <= WEEK_CARD_TOUCH_GAP_MINUTES ? groups[position - 1] : null;
    const next = position + 1 < groups.length && groupStart(groups[position + 1]) - groupEnd(group) <= WEEK_CARD_TOUCH_GAP_MINUTES ? groups[position + 1] : null;
    const target = previous && next
      ? sameCard(previous.card, group.card) !== sameCard(next.card, group.card)
        ? (sameCard(previous.card, group.card) ? previous : next)
        : groupSpan(next) > groupSpan(previous) ? next : previous
      : previous ?? next;
    if (!target && keeps(group)) { position += 1; continue; }
    groups.splice(position, 1);
    if (!target) continue;
    target.entries.push(...group.entries);
    target.entries.sort((a, b) => a.event.topMinutes - b.event.topMinutes);
    target.folded.push(...group.folded, ...(group.card && !sameCard(group.card, target.card) ? [group.card] : []));
    // The grown neighbour is checked again when it was short itself.
    if (target === previous) position = Math.max(0, position - 1);
  }

  const out: WeekCalendarEvent[] = [];
  const names = new Map<string, WeekCardBlockName>();
  const mergedIds: string[] = [];
  for (const group of groups) {
    if (group.entries.length === 1) {
      const [{ event, block }] = group.entries;
      out.push(event);
      names.set(event.id, { label: block ? { block, display: block.display, scope: "block" } : null });
      continue;
    }
    const own = group.entries.filter((entry) => sameCard(entry.card, group.card));
    const core = own.length > 0 ? own : group.entries;
    const extra = group.entries.filter((entry) => !core.includes(entry));
    const merged = mergeEvents(core.map((entry) => entry.event), extra.map((entry) => entry.event));
    out.push(merged);
    mergedIds.push(merged.id);
    names.set(merged.id, { label: mergedLabel(group, core, extra) });
  }
  return { events: out, names, mergedIds };
}

export function arrangeWeekCardBlocks(
  eventsByDay: ReadonlyMap<string, readonly WeekCalendarEvent[]>,
  index: ActivityLabelIndex,
  options: WeekCardBlockOptions,
): WeekCardBlocks {
  const arranged = new Map<string, WeekCalendarEvent[]>();
  const names = new Map<string, WeekCardBlockName>();
  const mergedIds = new Set<string>();
  for (const [day, events] of eventsByDay) {
    const result = arrangeDay(day, events, index, options);
    arranged.set(day, result.events);
    for (const [id, name] of result.names) names.set(id, name);
    for (const id of result.mergedIds) mergedIds.add(id);
  }
  return { eventsByDay: arranged, names, mergedIds };
}

/** Top (in minutes) of the next block below, so a block is drawn no taller than the space before it. */
export function weekNextBlockTopMinutes(events: readonly WeekCalendarEvent[], event: WeekCalendarEvent): number | null {
  let next: number | null = null;
  for (const other of events) {
    if (other.topMinutes > event.topMinutes && (next === null || other.topMinutes < next)) next = other.topMinutes;
  }
  return next;
}
