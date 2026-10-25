import { isExcludedSegment, type ActivitySegment } from "./activity";
import { isBrowserExtensionId, knownSiteServiceId } from "./aggregation";
import {
  activityDetailIsCatchAll,
  activityTitleSaysActivity,
  activityTitleSaysName,
  type ActivityTimelineCardDetail,
} from "./activityTimelineCards";
import { activitySecondsWithinInterval, activityTimeBounds } from "./deviceElapsedTime";

/**
 * What a card's details say inside one Day/Week block. A card's title names
 * its main activity (or a few, when it groups them); the other activities only
 * shared the card's stretch. So a line the title already says is not repeated,
 * activities the title does not name are never shown as part of it, and one
 * long enough to be a task of its own (five minutes or more) is shown apart.
 * An app or site the title names (Gmail in "Gmail과 카테고리 설명") is part of
 * it even when its records had no titles for a line to cite.
 * Time comes from the card's records inside the block; a record two lines
 * cite counts once, so the parts add up to the card's recorded time. The rest
 * (short activities, untitled use, leftover lines such as "기타 Drifty 대화",
 * lines past the limit) is told by app.
 */
export const CARD_DETAIL_MIN_LINE_SECONDS = 60;
export const CARD_DETAIL_SEPARATE_SECONDS = 5 * 60;
export const CARD_DETAIL_MAX_NAMED = 4;
export const CARD_DETAIL_MAX_ALONGSIDE = 3;

export type ActivityCardDetailLine = {
  readonly activity: string;
  readonly seconds: number;
  readonly startMs: number;
  readonly endMs: number;
  /** The card's records this line counts inside the block, for its colour, icon and highlight. */
  readonly segmentIds: readonly string[];
};

export type ActivityCardDetailView = {
  /** The card's records inside the block. */
  readonly recordedSeconds: number;
  /** Activities the title names, largest first. */
  readonly named: readonly ActivityCardDetailLine[];
  /**
   * Whether the named lines are listed under the title. A single named
   * activity is listed only when the title does not already say it and side
   * activities sit beside it; otherwise the line would only restate the title.
   */
  readonly namedListed: boolean;
  /** Other activities in the same stretch, a minute or more and shorter than a task. */
  readonly alongside: readonly ActivityCardDetailLine[];
  /** Other activities of five minutes or more: tasks of their own that the card did not cut out. */
  readonly separate: readonly ActivityCardDetailLine[];
  /** Recorded time no line shows: shorter activities, untitled use and lines past the limit. */
  readonly restSeconds: number;
  /** The rest's largest apps or sites, a minute or more each. */
  readonly restApps: readonly { readonly name: string; readonly seconds: number }[];
};

type CardLike = {
  readonly title: string;
  readonly segmentIds: readonly string[];
  readonly details: readonly ActivityTimelineCardDetail[];
};

/** How a record is told by app: its site, or its app when it has none. */
function recordName(segment: ActivitySegment): string {
  return segment.siteDomain?.trim() || segment.appName;
}

const SECOND_LEVEL = new Set(["co", "com", "ac", "or", "go", "ne", "net", "org"]);

/**
 * An address (an IP, localhost, a private network host or any name without a
 * dot) or a browser's own page (newtab, an extension's id) names no app or
 * site a reader would know.
 */
function isAddress(site: string): boolean {
  return !site.includes(".") || /^[\d.:[\]]+$/.test(site) || isBrowserExtensionId(site)
    || /\.(?:local|localhost|internal|lan|home\.arpa|ts\.net)$/.test(site);
}

/** Names a title could use for a record's app: the app, or a site's name and known service. Addresses have none. */
function appNames(segment: ActivitySegment): string[] {
  const site = segment.siteDomain?.trim().toLowerCase().replace(/^www\./, "");
  if (!site) return [segment.appName];
  if (isAddress(site)) return [];
  const labels = site.split(".");
  const name = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[Math.max(0, labels.length - 2)];
  const service = knownSiteServiceId(site);
  return [name, ...(service ? [service.replace(/-/g, " ")] : [])];
}

export function activityCardDetailView(
  card: CardLike,
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  rangeStartMs: number,
  rangeEndMs: number,
): ActivityCardDetailView {
  const own = new Set(card.segmentIds);
  const within = (id: string) => {
    const segment = segmentsById.get(id);
    if (!segment) return null;
    const seconds = activitySecondsWithinInterval(segment, rangeStartMs, rangeEndMs);
    if (!(seconds > 0)) return null;
    return {
      seconds,
      startMs: Math.max(Date.parse(segment.startedAt), rangeStartMs),
      endMs: Math.min(Date.parse(segment.endedAt), rangeEndMs),
    };
  };
  let recordedSeconds = 0;
  for (const id of own) recordedSeconds += within(id)?.seconds ?? 0;

  const ordered = orderedDetails(card, segmentsById, (id) => within(id)?.seconds ?? 0);
  const claimed = new Set<string>();
  const lines: { line: ActivityCardDetailLine; named: boolean; says: boolean; ids: string[] }[] = [];
  for (const detail of ordered) {
    let seconds = 0;
    let startMs = Infinity;
    let endMs = -Infinity;
    const ids: string[] = [];
    for (const id of detail.segmentIds) {
      if (!own.has(id) || claimed.has(id)) continue;
      const part = within(id);
      if (!part) continue;
      claimed.add(id);
      ids.push(id);
      seconds += part.seconds;
      startMs = Math.min(startMs, part.startMs);
      endMs = Math.max(endMs, part.endMs);
    }
    if (seconds >= CARD_DETAIL_MIN_LINE_SECONDS) {
      lines.push({ line: { activity: detail.activity, seconds, startMs, endMs, segmentIds: ids }, named: detail.named, says: activityTitleSaysActivity(card.title, detail.activity), ids });
    }
  }
  // Records no line holds, by app; an app or site the title names joins what it names.
  const lined = new Set(lines.flatMap((entry) => entry.ids));
  const byApp = new Map<string, { segment: ActivitySegment; ids: string[]; seconds: number; startMs: number; endMs: number }>();
  for (const id of own) {
    if (lined.has(id)) continue;
    const part = within(id);
    if (!part) continue;
    const segment = segmentsById.get(id)!;
    const name = recordName(segment);
    const group = byApp.get(name) ?? { segment, ids: [], seconds: 0, startMs: Infinity, endMs: -Infinity };
    group.ids.push(id);
    group.seconds += part.seconds;
    group.startMs = Math.min(group.startMs, part.startMs);
    group.endMs = Math.max(group.endMs, part.endMs);
    byApp.set(name, group);
  }
  for (const [name, group] of byApp) {
    if (group.seconds < CARD_DETAIL_MIN_LINE_SECONDS || !appNames(group.segment).some((alias) => activityTitleSaysName(card.title, alias))) continue;
    lines.push({ line: { activity: name, seconds: group.seconds, startMs: group.startMs, endMs: group.endMs, segmentIds: group.ids }, named: true, says: true, ids: group.ids });
  }
  const bySeconds = (left: { line: ActivityCardDetailLine }, right: { line: ActivityCardDetailLine }) => right.line.seconds - left.line.seconds;
  const named = lines.filter((entry) => entry.named).sort(bySeconds).slice(0, CARD_DETAIL_MAX_NAMED);
  const others = lines.filter((entry) => !entry.named);
  const alongside = others.filter((entry) => entry.line.seconds < CARD_DETAIL_SEPARATE_SECONDS).sort(bySeconds).slice(0, CARD_DETAIL_MAX_ALONGSIDE);
  const separate = others.filter((entry) => entry.line.seconds >= CARD_DETAIL_SEPARATE_SECONDS).sort((left, right) => left.line.startMs - right.line.startMs);
  const shownIds = new Set<string>();
  for (const entry of [...named, ...alongside, ...separate]) for (const id of entry.ids) shownIds.add(id);
  const restByName = new Map<string, number>();
  let restSeconds = 0;
  for (const id of own) {
    if (shownIds.has(id)) continue;
    const part = within(id);
    if (!part) continue;
    restSeconds += part.seconds;
    const segment = segmentsById.get(id)!;
    const site = segment.siteDomain?.trim().toLowerCase().replace(/^www\./, "");
    // Addresses still count in the rest's time, but are not named in it.
    if (site && isAddress(site)) continue;
    const name = recordName(segment);
    restByName.set(name, (restByName.get(name) ?? 0) + part.seconds);
  }
  const restApps = [...restByName.entries()]
    .filter(([, seconds]) => seconds >= CARD_DETAIL_MIN_LINE_SECONDS)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([name, seconds]) => ({ name, seconds }));
  return {
    recordedSeconds,
    named: named.map((entry) => entry.line),
    namedListed: named.length >= 2 || (named.length === 1 && !named[0].says && alongside.length > 0),
    alongside: alongside.map((entry) => entry.line),
    separate: separate.map((entry) => entry.line),
    restSeconds,
    restApps,
  };
}

/**
 * A card's lines in the order they claim records: named lines first, then larger ones, so a
 * record two lines cite counts once. Leftover lines stored before they were dropped at parsing
 * fall to the rest, and a line the title says word for word is named even without the stored mark.
 */
function orderedDetails(
  card: CardLike,
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  secondsOf: (id: string) => number,
): ActivityTimelineCardDetail[] {
  const own = new Set(card.segmentIds);
  const rough = (detail: ActivityTimelineCardDetail) => detail.segmentIds.reduce((total, id) => total + (own.has(id) ? secondsOf(id) : 0), 0);
  const sourceTitles = (detail: ActivityTimelineCardDetail) => detail.segmentIds.flatMap((id) => {
    const segment = segmentsById.get(id);
    return segment ? [segment.windowTitle, segment.siteTitle, segment.youtubeTitle].filter((title): title is string => Boolean(title)) : [];
  });
  return card.details
    .filter((detail) => !activityDetailIsCatchAll(detail.activity, sourceTitles(detail)))
    .map((detail) => detail.named || !activityTitleSaysActivity(card.title, detail.activity) ? detail : { ...detail, named: true })
    .sort((left, right) => Number(right.named) - Number(left.named) || rough(right) - rough(left));
}

export const CARD_RUN_JOIN_GAP_MS = 2 * 60_000;
export const CARD_RUN_MIN_SECONDS = 2 * 60;
export const CARD_RUN_ISOLATED_SECONDS = 60;
/** A line's name holds at least this share of its time; a second name shows from this share. */
export const CARD_RUN_MAIN_SHARE = 0.5;
export const CARD_RUN_ALSO_SHARE = 0.25;
// The lock screen and other system surfaces are not something the user did.
const SYSTEM_SURFACE_APPS = new Set(["loginwindow", "screensaverengine", "lockscreen", "windowserver"]);

export type ActivityCardDetailRunName = {
  readonly label: string;
  /** "activity": an activity a card's title evidence names; "app": records known only by their app or site. */
  readonly kind: "activity" | "app";
  readonly seconds: number;
};

export type ActivityCardDetailRun = ActivityCardDetailRunName & {
  readonly startMs: number;
  readonly endMs: number;
  /** Every record in the line's stretch, its own and brief detours it holds. */
  readonly totalSeconds: number;
  /** The second activity of the stretch, when it holds a quarter of it and a minute or more. */
  readonly also?: ActivityCardDetailRunName;
  readonly segmentIds: readonly string[];
};

/** How a record with no activity line is named: its site, or its app for an address or no site. */
function appLabel(segment: ActivitySegment): string {
  const site = segment.siteDomain?.trim();
  return site && !isAddress(site.toLowerCase().replace(/^www\./, "")) ? site : segment.appName;
}

/**
 * A Day/Week block's detail as a time-ordered log, as Dayflow's detailed summary is. Every record in
 * the block appears once, named by the card activity that cites it, or by its app or site when no
 * line does. Consecutive records of one name within two minutes join. A stretch under two minutes
 * joins its longer neighbour within two minutes only while that neighbour's name still holds half of
 * its time, so a line's name always says what most of it was; a second activity holding a quarter of
 * the line is named with it ("youtube.com · ChatGPT"). A lone blip under a minute is left out, as are
 * system surfaces such as the lock screen. No line sits under another, so none claims to be part of a
 * title. Records in the block outside every card are passed as otherSegmentIds.
 */
export function activityCardDetailRuns(
  cards: readonly CardLike[],
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  rangeStartMs: number,
  rangeEndMs: number,
  otherSegmentIds: readonly string[] = [],
  options: { readonly minSeconds?: number; readonly joinGapMs?: number } = {},
): ActivityCardDetailRun[] {
  const minSeconds = options.minSeconds ?? CARD_RUN_MIN_SECONDS;
  const joinGapMs = options.joinGapMs ?? CARD_RUN_JOIN_GAP_MS;
  type Name = { label: string; kind: "activity" | "app"; seconds: number };
  type Run = { startMs: number; endMs: number; seconds: number; segmentIds: string[]; names: Map<string, Name> };
  const items: Run[] = labelledRecords(cards, segmentsById, rangeStartMs, rangeEndMs, otherSegmentIds).map((record) => ({
    startMs: record.startMs,
    endMs: record.endMs,
    seconds: record.seconds,
    segmentIds: [record.id],
    names: new Map([[record.kind + "\u0000" + record.label, { label: record.label, kind: record.kind, seconds: record.seconds }]]),
  }));

  const main = (run: Run) => [...run.names.entries()].reduce((best, entry) => entry[1].seconds > best[1].seconds ? entry : best);
  const same = (left: Run, right: Run) => main(left)[0] === main(right)[0];
  const near = (left: Run, right: Run) => right.startMs - left.endMs <= joinGapMs;
  const join = (into: Run, from: Run) => {
    into.startMs = Math.min(into.startMs, from.startMs);
    into.endMs = Math.max(into.endMs, from.endMs);
    into.seconds += from.seconds;
    into.segmentIds.push(...from.segmentIds);
    for (const [key, name] of from.names) {
      const current = into.names.get(key);
      into.names.set(key, current ? { ...current, seconds: current.seconds + name.seconds } : { ...name });
    }
  };
  // Its name keeps at least half of the line's time once the other run is in it.
  const keepsName = (into: Run, from: Run) => {
    const [key, name] = main(into);
    return (name.seconds + (from.names.get(key)?.seconds ?? 0)) / (into.seconds + from.seconds) >= CARD_RUN_MAIN_SHARE;
  };
  const runs: Run[] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && same(last, item) && near(last, item)) join(last, item);
    else runs.push(item);
  }
  for (;;) {
    let best: { index: number; into: number } | null = null;
    for (let position = 0; position < runs.length; position += 1) {
      const run = runs[position];
      if (run.seconds >= minSeconds) continue;
      const options = [position - 1, position + 1]
        .filter((other) => other >= 0 && other < runs.length && runs[other].seconds > run.seconds
          && (other < position ? near(runs[other], run) : near(run, runs[other])) && keepsName(runs[other], run))
        .sort((left, right) => runs[right].seconds - runs[left].seconds);
      if (options.length && (!best || run.seconds < runs[best.index].seconds)) best = { index: position, into: options[0] };
    }
    if (!best) break;
    const into = runs[best.into];
    join(into, runs[best.index]);
    runs.splice(best.index, 1);
    const at = runs.indexOf(into);
    for (const position of [at, at - 1]) {
      const left = runs[position], right = runs[position + 1];
      if (position >= 0 && right && same(left, right) && near(left, right) && keepsName(left, right)) {
        join(left, right);
        runs.splice(position + 1, 1);
      }
    }
  }
  // A blip with nothing it could join (a few seconds of something) is not a line of its own.
  return runs.filter((run) => run.seconds >= CARD_RUN_ISOLATED_SECONDS).map((run) => {
    const names = [...run.names.values()].sort((left, right) => right.seconds - left.seconds);
    const also = names[1] && names[1].seconds >= 60 && names[1].seconds / run.seconds >= CARD_RUN_ALSO_SHARE ? names[1] : undefined;
    return {
      label: names[0].label,
      kind: names[0].kind,
      seconds: names[0].seconds,
      totalSeconds: run.seconds,
      ...(also ? { also } : {}),
      startMs: run.startMs,
      endMs: run.endMs,
      segmentIds: [...run.segmentIds].sort(),
    };
  });
}

type LabelledRecord = { id: string; label: string; kind: "activity" | "app"; startMs: number; endMs: number; seconds: number };

/**
 * The block's records in time order, each once, named by the card activity that cites it, or by its
 * app or site when no line does; system surfaces such as the lock screen are not records of use.
 */
function labelledRecords(
  cards: readonly CardLike[],
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  rangeStartMs: number,
  rangeEndMs: number,
  otherSegmentIds: readonly string[],
): LabelledRecord[] {
  const secondsOf = (id: string) => {
    const segment = segmentsById.get(id);
    return segment ? activitySecondsWithinInterval(segment, rangeStartMs, rangeEndMs) : 0;
  };
  const labelOf = new Map<string, string>();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const own = new Set(card.segmentIds);
    for (const detail of orderedDetails(card, segmentsById, secondsOf)) {
      for (const id of detail.segmentIds) if (own.has(id) && !labelOf.has(id)) labelOf.set(id, detail.activity);
    }
    for (const id of card.segmentIds) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  for (const id of otherSegmentIds) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  return ids.flatMap((id) => {
    const segment = segmentsById.get(id);
    if (!segment || isExcludedSegment(segment) || SYSTEM_SURFACE_APPS.has(segment.appName.trim().toLowerCase())) return [];
    const seconds = secondsOf(id);
    if (!(seconds > 0)) return [];
    const bounds = activityTimeBounds(segment);
    const activity = labelOf.get(id);
    return [{
      id,
      label: activity ?? appLabel(segment),
      kind: activity ? "activity" as const : "app" as const,
      startMs: Math.max(bounds.start, rangeStartMs),
      endMs: Math.min(bounds.end, rangeEndMs),
      seconds,
    }];
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export type ActivityCardDetailLogEntry = {
  readonly label: string;
  readonly kind: "activity" | "app";
  /** When it first and last happened in the block. */
  readonly firstMs: number;
  readonly lastMs: number;
  readonly seconds: number;
  /** How many separate times it happened (stretches more than two minutes apart). */
  readonly times: number;
  readonly segmentIds: readonly string[];
};

/**
 * A Day/Week block's activities, one line each, in the order they first happened, with their time
 * in the block: the card activities by name and untitled use by its app or site. A line under a
 * minute is left out. Unlike activityCardDetailRuns, switching back and forth adds no lines.
 */
export function activityCardDetailLog(
  cards: readonly CardLike[],
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  rangeStartMs: number,
  rangeEndMs: number,
  otherSegmentIds: readonly string[] = [],
): ActivityCardDetailLogEntry[] {
  const entries = new Map<string, { label: string; kind: "activity" | "app"; firstMs: number; lastMs: number; seconds: number; times: number; segmentIds: string[] }>();
  for (const record of labelledRecords(cards, segmentsById, rangeStartMs, rangeEndMs, otherSegmentIds)) {
    const key = record.kind + "\u0000" + record.label;
    const entry = entries.get(key);
    if (!entry) {
      entries.set(key, { label: record.label, kind: record.kind, firstMs: record.startMs, lastMs: record.endMs, seconds: record.seconds, times: 1, segmentIds: [record.id] });
      continue;
    }
    if (record.startMs - entry.lastMs > CARD_RUN_JOIN_GAP_MS) entry.times += 1;
    entry.lastMs = Math.max(entry.lastMs, record.endMs);
    entry.seconds += record.seconds;
    entry.segmentIds.push(record.id);
  }
  return [...entries.values()]
    .filter((entry) => entry.seconds >= CARD_RUN_ISOLATED_SECONDS)
    .sort((left, right) => left.firstMs - right.firstMs)
    .map((entry) => ({ ...entry, segmentIds: [...entry.segmentIds].sort() }));
}

export type ActivityCardDetailIdentity = {
  readonly id: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly siteDomain: string | null;
  readonly seconds: number;
};

/**
 * The apps and sites a stretch was spent in, most time first, for the icons beside its time. They
 * come from the same records as the stretch's log, so an icon never shows something the log does
 * not hold: excluded records and system surfaces are left out, and an address counts as its
 * browser, as the log names it.
 */
export function activityCardDetailIdentities(
  segmentsById: ReadonlyMap<string, ActivitySegment>,
  rangeStartMs: number,
  rangeEndMs: number,
  segmentIds: readonly string[],
): ActivityCardDetailIdentity[] {
  const byKey = new Map<string, ActivityCardDetailIdentity & { readonly firstMs: number }>();
  for (const id of new Set(segmentIds)) {
    const segment = segmentsById.get(id);
    if (!segment || isExcludedSegment(segment) || SYSTEM_SURFACE_APPS.has(segment.appName.trim().toLowerCase())) continue;
    const seconds = activitySecondsWithinInterval(segment, rangeStartMs, rangeEndMs);
    if (!(seconds > 0)) continue;
    const appName = segment.appName.trim() || "Unknown app";
    const bundleId = segment.bundleId?.trim() || null;
    const site = segment.siteDomain?.trim() || null;
    const siteDomain = site && !isAddress(site.toLowerCase().replace(/^www\./, "")) ? site : null;
    const key = siteDomain ? "site:" + siteDomain.toLowerCase() : "app:" + (bundleId ?? appName);
    const firstMs = Math.max(activityTimeBounds(segment).start, rangeStartMs);
    const known = byKey.get(key);
    byKey.set(key, known
      ? { ...known, seconds: known.seconds + seconds, firstMs: Math.min(known.firstMs, firstMs) }
      : { id: key, appName, bundleId, siteDomain, seconds, firstMs });
  }
  return [...byKey.values()]
    .sort((left, right) => right.seconds - left.seconds || left.firstMs - right.firstMs)
    .map(({ id, appName, bundleId, siteDomain, seconds }) => ({ id, appName, bundleId, siteDomain, seconds }));
}
