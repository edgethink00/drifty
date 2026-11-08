import type { MemorySessionNote, MemoryWikiLine, MemoryWikiPage } from "../screen-context/memoryWire";
import { pageEntries, plainDocText, startOfLocalDay, textMatches, WIKI_KIND_ORDER } from "./memoryWikiModel";

/** A remembered line as it appears in the flow: the page it was filed on and what became of it since. */
export type FlowLine = {
  readonly page: MemoryWikiPage; readonly line: MemoryWikiLine;
  /** Earlier versions this current line replaced. */
  readonly earlier: number;
};

/** A screen kept for the session's lines; it opens in the screen viewer until retention deletes it. */
export type FlowOriginal = { readonly id: string; readonly app: string; readonly observedAt: number };

/**
 * A stretch of work: lines whose screens were first seen close together on one day.
 * Sessions are derived on every read from when each line's screen was first seen,
 * by the same rule the engine uses; a line seen again later stays where it began. Once a session has closed the engine
 * writes it a note (a title, a summary and what happened); the note shows only
 * beside exactly the lines it was written from, so a session that changed
 * since reads as its lines until it is written again.
 */
export type FlowSession = {
  readonly id: string; readonly start: number; readonly end: number;
  /** The note's title, or else the one or two pages the session is mostly about, by name. */
  readonly title: string;
  /** The newest current line of the main page, shown under the title when there is no note. */
  readonly lead: string;
  readonly pages: readonly MemoryWikiPage[]; readonly apps: readonly string[];
  readonly lines: readonly FlowLine[]; readonly originals: readonly FlowOriginal[];
  readonly note: MemorySessionNote | null;
};

export type FlowDay = { readonly day: number; readonly sessions: readonly FlowSession[]; readonly lines: number };

/** Screens seen within this long of each other belong to one session. */
export const SESSION_GAP_MS = 25 * 60_000;
/** A long run of close screens still breaks into sessions of at most this long. */
export const SESSION_SPAN_MS = 45 * 60_000;

function rank(page: MemoryWikiPage): number {
  return WIKI_KIND_ORDER.indexOf(page.kind);
}

function lineSet(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

function session(lines: FlowLine[], notes: ReadonlyMap<string, MemorySessionNote>): FlowSession {
  const byPage = new Map<string, { page: MemoryWikiPage; weight: number; newest: FlowLine | null }>();
  for (const item of lines) {
    const entry = byPage.get(item.page.id) ?? { page: item.page, weight: 0, newest: null };
    // What the page says now outweighs what it said before.
    entry.weight += item.line.status === "current" ? 1 : 0.5;
    if (item.line.status === "current" && (!entry.newest || item.line.firstSeenAt > entry.newest.line.firstSeenAt)) entry.newest = item;
    byPage.set(item.page.id, entry);
  }
  const ranked = [...byPage.values()].sort((a, b) => b.weight - a.weight || rank(a.page) - rank(b.page) || a.page.title.localeCompare(b.page.title));
  const apps = new Map<string, number>();
  const originals = new Map<string, FlowOriginal>();
  for (const { line } of lines) {
    apps.set(line.app, (apps.get(line.app) ?? 0) + 1);
    for (const id of line.originalIds) if (!originals.has(id)) originals.set(id, { id, app: line.app, observedAt: line.observedAt });
  }
  // What still holds comes first, newest first; what has changed since follows.
  const ordered = [...lines].sort((a, b) => (a.line.status === b.line.status ? 0 : a.line.status === "current" ? -1 : 1)
    || b.line.firstSeenAt - a.line.firstSeenAt || rank(a.page) - rank(b.page));
  const lead = ranked[0].newest ?? ordered[0];
  const note = notes.get(lineSet(lines.map((item) => item.line.id))) ?? null;
  return {
    id: lines[0].line.id,
    start: Math.min(...lines.map((item) => item.line.firstSeenAt)),
    end: Math.max(...lines.map((item) => item.line.firstSeenAt)),
    title: note?.title ?? ranked.slice(0, 2).map((item) => item.page.title).join(" · "),
    lead: lead.line.text,
    pages: ranked.map((item) => item.page),
    apps: [...apps.entries()].sort((a, b) => b[1] - a[1]).map(([app]) => app),
    lines: ordered,
    originals: [...originals.values()].sort((a, b) => a.observedAt - b.observedAt),
    note,
  };
}

/**
 * Every line, current and replaced, grouped into sessions and days, newest
 * first. A replaced line stays in the session where it was first seen, so the
 * flow shows what was known then and the page shows what is known now.
 */
export function flowDays(pages: readonly MemoryWikiPage[], notes: readonly MemorySessionNote[] = [], gap = SESSION_GAP_MS, span = SESSION_SPAN_MS): FlowDay[] {
  const byLines = new Map(notes.map((note) => [lineSet(note.lineIds), note]));
  const items: FlowLine[] = pages.flatMap((page) => {
    const { current } = pageEntries(page);
    const earlier = new Map(current.map((entry) => [entry.line.id, entry.history.length]));
    return page.lines.map((line) => ({ page, line, earlier: earlier.get(line.id) ?? 0 }));
  }).sort((a, b) => a.line.firstSeenAt - b.line.firstSeenAt);
  const sessions: FlowSession[] = [];
  let open: FlowLine[] = [];
  for (const item of items) {
    const last = open[open.length - 1];
    const seen = item.line.firstSeenAt;
    if (last && (seen - last.line.firstSeenAt > gap || seen - open[0].line.firstSeenAt > span
      || startOfLocalDay(new Date(seen)) !== startOfLocalDay(new Date(last.line.firstSeenAt)))) {
      sessions.push(session(open, byLines)); open = [];
    }
    open.push(item);
  }
  if (open.length > 0) sessions.push(session(open, byLines));
  const days = new Map<number, FlowSession[]>();
  for (const item of sessions.reverse()) {
    const day = startOfLocalDay(new Date(item.start));
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, sessions: list, lines: list.reduce((count, item) => count + item.lines.length, 0) }));
}

/** A session matches when its note, one of its lines or one of its pages does. */
export function sessionMatches(item: FlowSession, query: string): boolean {
  if (!query.trim()) return true;
  const note = item.note ? [item.note.title, ...[...item.note.summary, ...item.note.points].map((point) => plainDocText(point.text))] : [];
  return note.some((text) => textMatches(text, query)) || item.pages.some((page) => textMatches(page.title, query)) || item.lines.some(({ line }) => textMatches(line.text, query));
}

/** Days narrowed to matching sessions, dropping days left empty. */
export function filterFlow(days: readonly FlowDay[], query: string, since: number | null = null): FlowDay[] {
  return days.flatMap((day) => {
    if (since !== null && day.day < since) return [];
    const sessions = day.sessions.filter((item) => sessionMatches(item, query));
    return sessions.length === 0 ? [] : [{ day: day.day, sessions, lines: sessions.reduce((count, item) => count + item.lines.length, 0) }];
  });
}
