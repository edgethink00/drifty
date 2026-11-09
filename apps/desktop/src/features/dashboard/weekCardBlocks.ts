import { isSystemSurfaceApp, logicalDayStartMs, mergedBlockTitleKey, type MergedBlockTitleCard } from "@drifty/domain";
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
 *   drawn in Week. Your Day keeps it as its own block when it clears 40% of
 *   the short bar (loneBlockShare, LONE_BLOCK_SHARE): its lane has room beside
 *   a lone piece, but a lone minute is not worth a name.
 * - A merged block keeps the category, productivity and leading app of its own
 *   card's blocks; folded pieces add only their time and apps, and its card
 *   lists their cards with their start time.
 */
export const WEEK_CARD_SHORT_BLOCK_MINUTES = 14;
export const WEEK_CARD_LINE_ACTIVE_MINUTES = 4;
export const WEEK_CARD_TOUCH_GAP_MINUTES = 2;
export const WEEK_CARD_MERGE_GAP_MINUTES = 10;

/** Owner decision 2026-10-28: where nothing touches a short block, Your Day
 *  names it once it clears this share of the short bar, both parts: a span of
 *  at least 5.6 of 14 minutes and more than 1.6 of 4 recorded minutes. In
 *  whole minutes, 6 minutes long with at least 2 recorded. */
export const LONE_BLOCK_SHARE = 0.4;

/** Whether a block of this span and recorded time clears `share` of the short
 *  bar; at a share of 1 this is exactly "not short". */
export function clearsShortBar(spanMinutes: number, recordedMinutes: number, share = 1): boolean {
  return spanMinutes >= WEEK_CARD_SHORT_BLOCK_MINUTES * share && recordedMinutes > WEEK_CARD_LINE_ACTIVE_MINUTES * share;
}

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
  /** How many other activities (other card titles, or unnamed app time) of 3 minutes or more
   *  hold half or more of a merged block's recorded time; absent when its name covers most of it. */
  readonly others?: number;
  /** A merged block its first card's name does not cover asks for a name of its own: the key
   *  its name is stored under and the cards' titles and minutes it is made from. */
  readonly retitle?: { readonly key: string; readonly cards: readonly MergedBlockTitleCard[]; readonly apps: readonly string[] };
  /** The block is named by its own stored name (retitle), not one card's. */
  readonly retitled?: boolean;
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
  /** Keep a short block that touches nothing as its own block when it clears
   *  this share of the short bar, instead of leaving it out. Folding into a
   *  touching neighbour is unchanged. Week leaves it unset. */
  readonly loneBlockShare?: number;
  /** Names stored for merged blocks (mergedBlockTitleKey), in the language they were made in. */
  readonly mergedTitles?: { readonly language: string; readonly get: (key: string) => string | undefined };
};

type Entry = { readonly event: WeekCalendarEvent; readonly block: ActivityLabelBlock | null; readonly card: ActivityLabelBlockCard | null };
/** `own`: the card keys that are the group's own activity (the same card, a card of the same
 *  name, or the same activity continued past a naming window); other entries were folded in. */
type Group = { readonly card: ActivityLabelBlockCard | null; readonly entries: Entry[]; readonly folded: ActivityLabelBlockCard[]; readonly own: Set<string> };

const end = (event: WeekCalendarEvent) => event.topMinutes + event.durationMinutes;
const groupStart = (group: Group) => Math.min(...group.entries.map((entry) => entry.event.topMinutes));
const groupEnd = (group: Group) => Math.max(...group.entries.map((entry) => end(entry.event)));
const groupSpan = (group: Group) => groupEnd(group) - groupStart(group);
const groupRecorded = (group: Group) => group.entries.reduce((sum, entry) => sum + entry.event.activeDurationMinutes, 0);
const isShortEvent = (event: WeekCalendarEvent) => !clearsShortBar(event.durationMinutes, event.activeDurationMinutes);
const isShortGroup = (group: Group) => !clearsShortBar(groupSpan(group), groupRecorded(group));
const sameCard = (a: ActivityLabelBlockCard | null, b: ActivityLabelBlockCard | null) => Boolean(a && b && a.key === b.key);
const normTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");
const sameName = (a: ActivityLabelBlockCard | null, b: ActivityLabelBlockCard | null) => Boolean(a && b && normTitle(a.title) === normTitle(b.title));
/** Card keys are `<window key>:c<position>` (storedActivityTimelineCards). */
const windowOf = (card: ActivityLabelBlockCard) => card.key.slice(0, Math.max(0, card.key.lastIndexOf(":c")));
const leadIdentity = (event: WeekCalendarEvent) => event.identities[0]?.id ?? null;
const PASSIVE_CATEGORIES: ReadonlySet<string> = new Set(["entertainment", "social_media"]);
const UNNAMED = "\u0000";

function titleWords(title: string): Set<string> {
  return new Set(normTitle(title).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1));
}

/** Titles that share at least two thirds of the shorter one's words ("Drifty YC Winter 2027 application" / "Drifty YC application"). */
function similarTitles(a: string, b: string): boolean {
  const x = titleWords(a), y = titleWords(b);
  const smaller = Math.min(x.size, y.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  return shared / smaller >= 2 / 3;
}

/**
 * Naming windows close at 60 minutes, so one long stretch of the same thing gets a card per
 * window, each with its own title. A block of the next window's card continues the group when
 * it touches it, leads with the same app or site, and is either passive browsing (entertainment,
 * social media) on both sides or titled with mostly the same words.
 */
function continuesAcrossWindow(group: Group, entry: Entry): boolean {
  const last = [...group.entries].reverse().find((item) => item.card && group.own.has(item.card.key));
  if (!last?.card || !entry.card || windowOf(last.card) === windowOf(entry.card)) return false;
  if (entry.event.topMinutes - end(last.event) > WEEK_CARD_TOUCH_GAP_MINUTES) return false;
  const lead = leadIdentity(last.event);
  if (lead === null || lead !== leadIdentity(entry.event)) return false;
  return (PASSIVE_CATEGORIES.has(last.event.category) && PASSIVE_CATEGORIES.has(entry.event.category))
    || similarTitles(last.card.title, entry.card.title);
}

const isOwn = (group: Group, entry: Entry) => (entry.card ? group.own.has(entry.card.key) : !group.card);
/** The card that will name the group: its own card with the most recorded time. */
function hostCard(group: Group): ActivityLabelBlockCard | null {
  const minutes = new Map<string, { card: ActivityLabelBlockCard; value: number }>();
  for (const entry of group.entries) {
    if (!entry.card || !group.own.has(entry.card.key)) continue;
    const known = minutes.get(entry.card.key);
    minutes.set(entry.card.key, { card: entry.card, value: (known?.value ?? 0) + entry.event.activeDurationMinutes });
  }
  return [...minutes.values()].sort((a, b) => b.value - a.value)[0]?.card ?? null;
}
/** Unnamed groups of the same leading app or site. */
const sameUnnamed = (a: Group, b: Group) => !a.card && !b.card
  && leadIdentity(a.entries[0].event) !== null && leadIdentity(a.entries[0].event) === leadIdentity(b.entries[0].event);

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
    sourceTimeRanges: list.every(event => event.sourceTimeRanges !== undefined)
      ? list.flatMap(event => event.sourceTimeRanges!) : undefined,
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
  const ordered = [...core].sort((a, b) => b.event.activeDurationMinutes - a.event.activeDurationMinutes);
  // A name the user cleared stays cleared; otherwise the block's own card with the most recorded
  // time names it. A folded piece names it only when no own card can, so the name and the
  // leading app's icon (which the own cards decide) stay together.
  const minutes = new Map<string, number>();
  for (const entry of [...core, ...extra]) {
    if (entry.card) minutes.set(normTitle(entry.card.title), (minutes.get(normTitle(entry.card.title)) ?? 0) + entry.event.activeDurationMinutes);
  }
  const longestOf = (entries: readonly Entry[]) => entries
    .filter((entry) => entry.card && entry.block?.display)
    .sort((a, b) => (minutes.get(normTitle(b.card!.title)) ?? 0) - (minutes.get(normTitle(a.card!.title)) ?? 0) || b.event.activeDurationMinutes - a.event.activeDurationMinutes)[0];
  const longest = longestOf(core) ?? longestOf(extra);
  const host = ordered.find(entry => entry.block?.resolution.kind === "user" && !entry.block.display)?.block
    ?? ordered.find(entry => entry.block?.resolution.kind === "user")?.block
    ?? longest?.block ?? ordered[0]?.block ?? null;
  if (!host) return null;
  const hostTitle = normTitle(host.display?.title ?? host.card?.title ?? "");
  const members = [...new Map(core.flatMap((entry) => entry.block ? [[entry.block.key, entry.block] as const] : [])).values()];
  const others = new Map<string, ActivityLabelOtherCard>();
  const add = (card: ActivityLabelOtherCard) => {
    if (normTitle(card.title) === hostTitle) return;
    others.set(card.startMs + ":" + card.title, card);
  };
  for (const member of members) member.otherCards.forEach(add);
  for (const entry of [...core, ...extra]) if (entry.card) add(entry.card);
  group.folded.forEach(add);
  return {
    block: { ...host, otherCards: [...others.values()].sort((a, b) => a.startMs - b.startMs).slice(0, 3) },
    display: host.display,
    scope: "block",
    members,
  };
}

/** Other activities that hold half or more of a merged block, when its name does not cover
 *  them. A title worded like the name ("Drifty YC Winter 2027 application") counts as the name.
 *  Such a block asks for a name of its own (mergedBlockTitleKey): its cards' titles and minutes. */
function otherActivities(group: Group, label: ActivityInspectorLabel | null): { readonly count: number; readonly cards: MergedBlockTitleCard[]; readonly cardKeys: string[]; readonly apps: string[] } | undefined {
  const shown = label?.display?.title ?? label?.block.card?.title ?? "";
  const hostTitle = normTitle(shown);
  const minutes = new Map<string, number>();
  for (const entry of group.entries) {
    const key = entry.card ? (similarTitles(entry.card.title, shown) ? hostTitle : normTitle(entry.card.title)) : UNNAMED;
    minutes.set(key, (minutes.get(key) ?? 0) + entry.event.activeDurationMinutes);
  }
  const total = [...minutes.values()].reduce((sum, value) => sum + value, 0);
  const host = minutes.get(hostTitle) ?? 0;
  const others = [...minutes.entries()].filter(([key, value]) => key !== hostTitle && value >= 3);
  // Under half, the name still says what most of the block was; the Breakdown lists the rest.
  if (others.length === 0 || total - host < total / 2) return undefined;
  const byTitle = new Map<string, MergedBlockTitleCard & { start: number }>();
  for (const entry of [...group.entries].sort((a, b) => a.event.topMinutes - b.event.topMinutes)) {
    if (!entry.card) continue;
    const key = normTitle(entry.card.title);
    const known = byTitle.get(key);
    byTitle.set(key, { title: known?.title ?? entry.card.title, minutes: (known?.minutes ?? 0) + entry.event.activeDurationMinutes, start: known?.start ?? entry.event.topMinutes });
  }
  const cards = [...byTitle.values()].sort((a, b) => a.start - b.start).map(({ title, minutes: value }) => ({ title, minutes: value }));
  const cardKeys = [...new Set(group.entries.flatMap((entry) => (entry.card ? [entry.card.key] : [])))];
  const apps = [...new Set(group.entries.flatMap((entry) => entry.event.identities.flatMap((identity) => [identity.label, identity.appName]).filter(Boolean)))];
  return { count: others.length, cards, cardKeys, apps };
}

function arrangeDay(day: string, events: readonly WeekCalendarEvent[], index: ActivityLabelIndex, options: WeekCardBlockOptions) {
  const dayStartMs = logicalDayStartMs(day, options.startOfDayMinutes);
  const insideCard = (event: WeekCalendarEvent, card: ActivityLabelBlockCard) => (
    dayStartMs + event.topMinutes * 60_000 >= card.startMs - 60_000 && dayStartMs + end(event) * 60_000 <= card.endMs + 60_000
  );
  const sorted = [...events].sort((a, b) => a.topMinutes - b.topMinutes || b.durationMinutes - a.durationMinutes);
  const groups: Group[] = [];
  for (const event of sorted) {
    const block = index.forSegments(day, event.segmentIds, event);
    const entry: Entry = { event, block, card: block?.card ?? null };
    const last = groups[groups.length - 1];
    if (last && event.topMinutes - groupEnd(last) <= WEEK_CARD_MERGE_GAP_MINUTES) {
      const lastEntry = last.entries[last.entries.length - 1];
      const own = Boolean(entry.card && last.own.has(entry.card.key))
        || sameName(last.card, entry.card)
        || continuesAcrossWindow(last, entry)
        // Unnamed stretches of the same app or site (the lock screen across a short wake).
        || (!last.card && !entry.card && leadIdentity(event) !== null && leadIdentity(event) === leadIdentity(lastEntry.event));
      if (own) {
        last.entries.push(entry);
        if (entry.card) last.own.add(entry.card.key);
        continue;
      }
      // A short piece inside any of the group's own cards (a group can hold several since the
      // same name and naming-window continuations join it).
      const ownCards = last.entries.flatMap((item) => (item.card && last.own.has(item.card.key) ? [item.card] : []));
      if (isShortEvent(event) && ownCards.some((card) => insideCard(event, card))) {
        last.entries.push(entry);
        continue;
      }
    }
    groups.push({ card: entry.card, entries: [entry], folded: [], own: new Set(entry.card ? [entry.card.key] : []) });
  }

  const keeps = (group: Group) => Boolean(options.keepSegmentId && group.entries.some((entry) => entry.event.segmentIds.includes(options.keepSegmentId!)));
  const standsAlone = (group: Group) => options.loneBlockShare !== undefined && clearsShortBar(groupSpan(group), groupRecorded(group), options.loneBlockShare);
  // The lock screen is not an activity: it never folds into one or takes one in.
  const isLock = (group: Group) => group.entries.every((entry) => isSystemSurfaceApp(entry.event.identities[0]?.appName));
  const touches = (a: Group, b: Group) => groupStart(b) - groupEnd(a) <= WEEK_CARD_TOUCH_GAP_MINUTES;
  let position = 0;
  while (position < groups.length) {
    const group = groups[position];
    if (!isShortGroup(group)) { position += 1; continue; }
    const neighbour = (other: Group) => (isLock(other) || isLock(group) ? null : other);
    const previous = position > 0 && touches(groups[position - 1], group) ? neighbour(groups[position - 1]) : null;
    const next = position + 1 < groups.length && touches(group, groups[position + 1]) ? neighbour(groups[position + 1]) : null;
    const target = previous && next
      ? sameCard(previous.card, group.card) !== sameCard(next.card, group.card)
        ? (sameCard(previous.card, group.card) ? previous : next)
        : groupSpan(next) > groupSpan(previous) ? next : previous
      : previous ?? next;
    if (!target && (standsAlone(group) || keeps(group))) { position += 1; continue; }
    groups.splice(position, 1);
    if (!target) continue;
    target.entries.push(...group.entries);
    target.entries.sort((a, b) => a.event.topMinutes - b.event.topMinutes);
    target.folded.push(...group.folded, ...(group.card && !sameCard(group.card, target.card) ? [group.card] : []));
    // The grown neighbour is checked again when it was short itself.
    if (target === previous) position = Math.max(0, position - 1);
  }

  // Blocks of the same name a short break apart are one block, also when a short piece between
  // them folded away (two windows each named "OpenFront play").
  for (let index = 1; index < groups.length;) {
    const before = groups[index - 1], after = groups[index];
    if ((sameName(hostCard(before), hostCard(after)) || sameUnnamed(before, after)) && groupStart(after) - groupEnd(before) <= WEEK_CARD_MERGE_GAP_MINUTES) {
      before.entries.push(...after.entries);
      before.entries.sort((a, b) => a.event.topMinutes - b.event.topMinutes);
      after.own.forEach((key) => before.own.add(key));
      before.folded.push(...after.folded);
      groups.splice(index, 1);
    } else index += 1;
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
    const own = group.entries.filter((entry) => isOwn(group, entry));
    const core = own.length > 0 ? own : group.entries;
    const extra = group.entries.filter((entry) => !core.includes(entry));
    const merged = mergeEvents(core.map((entry) => entry.event), extra.map((entry) => entry.event));
    out.push(merged);
    mergedIds.push(merged.id);
    const label = mergedLabel(group, core, extra);
    // A name the user gave stays. Otherwise a block whose first card covers under half asks for
    // a name of its own and, once stored, is called by it wherever it is read (lane, panel, Week).
    const others = label?.block.resolution.kind === "user" ? undefined : otherActivities(group, label);
    if (others === undefined) {
      names.set(merged.id, { label });
      continue;
    }
    // With one card's name in it there is nothing to combine: its name stays and counts the rest.
    if (others.cards.length < 2) {
      names.set(merged.id, { label, others: others.count });
      continue;
    }
    const retitle = { key: mergedBlockTitleKey(others.cardKeys, options.mergedTitles?.language ?? ""), cards: others.cards, apps: others.apps };
    const stored = options.mergedTitles ? options.mergedTitles.get(retitle.key) : undefined;
    if (stored && label?.display) {
      names.set(merged.id, { label: { ...label, display: { ...label.display, title: stored, description: "" } }, retitle, retitled: true });
    } else {
      names.set(merged.id, { label, others: others.count, retitle });
    }
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
