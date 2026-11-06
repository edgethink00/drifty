import type { MemoryDocPoint, MemoryWikiDoc, MemoryWikiLine, MemoryWikiPage } from "../screen-context/memoryWire";

export type WikiKind = MemoryWikiPage["kind"];
export const WIKI_KIND_ORDER: readonly WikiKind[] = ["project", "person", "topic"];

/** A current line with the earlier lines it replaced, newest first. */
export type WikiEntry = { readonly line: MemoryWikiLine; readonly history: readonly MemoryWikiLine[] };

/**
 * Current lines in the page's order, each followed by the chain of lines it
 * replaced. A past line whose replacement was deleted is still part of the
 * page's history, so it stays readable at the end instead of disappearing.
 */
export function pageEntries(page: MemoryWikiPage): { readonly current: WikiEntry[]; readonly orphans: MemoryWikiLine[] } {
  const byId = new Map(page.lines.map((line) => [line.id, line]));
  const used = new Set<string>();
  const current = page.lines.filter((line) => line.status === "current").map((line) => {
    const history: MemoryWikiLine[] = [];
    let previous = line.replaces ? byId.get(line.replaces) : undefined;
    while (previous && previous.status === "past" && !used.has(previous.id)) {
      used.add(previous.id);
      history.push(previous);
      previous = previous.replaces ? byId.get(previous.replaces) : undefined;
    }
    return { line, history };
  });
  return { current, orphans: page.lines.filter((line) => line.status === "past" && !used.has(line.id)) };
}

export function currentLineCount(page: MemoryWikiPage): number {
  return page.lines.reduce((count, line) => count + (line.status === "current" ? 1 : 0), 0);
}

/** The current memory a line is, or the one that replaced it since. */
export function entryOf(page: MemoryWikiPage, lineId: string): WikiEntry | null {
  return pageEntries(page).current.find((entry) => entry.line.id === lineId || entry.history.some((past) => past.id === lineId)) ?? null;
}

/** A memory anywhere in the wiki with the page it is on, as entryOf finds it. */
export function findEntry(pages: readonly MemoryWikiPage[], lineId: string): PageEntry | null {
  for (const page of pages) {
    const entry = entryOf(page, lineId);
    if (entry) return { page, entry };
  }
  return null;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Case- and spacing-insensitive containment, the one search every view uses. */
export function textMatches(text: string, query: string): boolean {
  const wanted = normalize(query);
  return !wanted || normalize(text).includes(wanted);
}

/** Title, document or current-line match; past lines are history, not what the page says now. */
export function pageMatches(page: MemoryWikiPage, query: string): boolean {
  if (!normalize(query)) return true;
  return textMatches(page.title, query) || page.lines.some((line) => line.status === "current" && textMatches(line.text, query))
    || (page.doc ? docPoints(page.doc).some((point) => textMatches(plainDocText(point.text), query)) : false);
}

const WORD = /[\p{L}\p{N}]/u;
const ASCII_WORD = /[a-z0-9]/;

/** A whole-word mention. Hangul particles attach to the name ("Mira가"), so a
 * name ending in a non-ASCII letter may be followed by one. */
function mentions(text: string, key: string): boolean {
  if (!key) return false;
  const asciiEnd = ASCII_WORD.test(key[key.length - 1]);
  for (let index = text.indexOf(key); index >= 0; index = text.indexOf(key, index + 1)) {
    const before = text[index - 1];
    const after = text[index + key.length];
    if ((!before || !WORD.test(before)) && (!after || !asciiEnd || !ASCII_WORD.test(after))) return true;
  }
  return false;
}

/** The full title, plus a distinctive first word ("Juniper" for "Juniper release"). */
function mentionKeys(title: string): string[] {
  const keys = [normalize(title)];
  const words = title.trim().split(/\s+/);
  if (words.length > 1 && /^[A-Z][A-Za-z0-9]{3,}$/.test(words[0])) keys.push(normalize(words[0]));
  return keys;
}

export type WikiLink = { readonly source: string; readonly target: string; readonly weight: number };

/**
 * Pages link when one's document names the other as [[Title]], or when a
 * current line of one names the other (pages without a document yet). Derived
 * on every read at no model cost. Weight counts the linking sentences and
 * lines in both directions.
 */
export function wikiLinks(pages: readonly MemoryWikiPage[]): WikiLink[] {
  const texts = new Map(pages.map((page) => [page.id, page.lines.filter((line) => line.status === "current").map((line) => normalize(line.text))]));
  const named = new Map(pages.map((page) => [page.id, page.doc ? docPoints(page.doc).flatMap((point) => [...point.text.matchAll(LINK)].map((match) => normalize(match[1]))) : []]));
  const weights = new Map<string, WikiLink>();
  for (const target of pages) {
    const keys = mentionKeys(target.title);
    const title = normalize(target.title);
    for (const source of pages) {
      if (source.id === target.id) continue;
      const count = (texts.get(source.id) ?? []).filter((text) => keys.some((key) => mentions(text, key))).length
        + (named.get(source.id) ?? []).filter((name) => name === title).length;
      if (count === 0) continue;
      const [a, b] = source.id < target.id ? [source.id, target.id] : [target.id, source.id];
      const key = a + ":" + b;
      weights.set(key, { source: a, target: b, weight: (weights.get(key)?.weight ?? 0) + count });
    }
  }
  return [...weights.values()];
}

export function linkedPageIds(pageId: string, links: readonly WikiLink[]): string[] {
  return links.flatMap((link) => link.source === pageId ? [link.target] : link.target === pageId ? [link.source] : []);
}

/**
 * The pages linked to this one either way, once each and in the wiki's order.
 * The wiki files a fact on every page it is about, so the sentence that makes
 * a link usually repeats a line already on this page; the page name is enough.
 */
export function linkedPages(pageId: string, pages: readonly MemoryWikiPage[], links: readonly WikiLink[]): MemoryWikiPage[] {
  const ids = new Set(linkedPageIds(pageId, links));
  return pages.filter((page) => ids.has(page.id));
}

export function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** When the wiki wrote the line; older wikis only know when the screen was seen. */
export function writtenAt(line: MemoryWikiLine): number {
  return line.createdAt ?? line.observedAt;
}

/**
 * What a reader needs to know about a current line: how many earlier versions
 * it replaced, and whether the wiki wrote it today (new or replacing).
 */
export type LineState = { readonly replaced: number; readonly today: boolean };

export function lineState(entry: WikiEntry, now: Date): LineState {
  return { replaced: entry.history.length, today: writtenAt(entry.line) >= startOfLocalDay(now) };
}

export type PageEntry = { readonly page: MemoryWikiPage; readonly entry: WikiEntry };

/** Every current line with its history, newest written first. */
export function allEntries(pages: readonly MemoryWikiPage[]): PageEntry[] {
  return pages.flatMap((page) => pageEntries(page).current.map((entry) => ({ page, entry })))
    .sort((a, b) => writtenAt(b.entry.line) - writtenAt(a.entry.line));
}

export function changedToday(page: MemoryWikiPage, now: Date): boolean {
  return page.updatedAt >= startOfLocalDay(now);
}



// ── Page documents ──

const LINK = /\[\[([^[\]\n]{1,80})\]\]/g;

/** Every sentence of a document, summary first. */
export function docPoints(doc: MemoryWikiDoc): MemoryDocPoint[] {
  return [...doc.summary, ...doc.sections.flatMap((section) => section.points)];
}

/** A document sentence without its link brackets, for search and plain reading. */
export function plainDocText(text: string): string {
  return text.replace(LINK, "$1");
}

export type DocSegment = { readonly kind: "text"; readonly text: string } | { readonly kind: "link"; readonly text: string; readonly pageId: string | null };

/** A sentence split into plain text and [[Title]] links, each resolved to its page when it still exists. */
export function docSegments(text: string, pageIdByTitle: ReadonlyMap<string, string>): DocSegment[] {
  const segments: DocSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > at) segments.push({ kind: "text", text: text.slice(at, match.index) });
    segments.push({ kind: "link", text: match[1], pageId: pageIdByTitle.get(normalize(match[1])) ?? null });
    at = match.index + match[0].length;
  }
  if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
  return segments;
}

export function pageIdsByTitle(pages: readonly MemoryWikiPage[]): Map<string, string> {
  return new Map(pages.map((page) => [normalize(page.title), page.id]));
}

/** Footnote numbers for the lines some sentences cite, in reading order. */
export function citationOrder(points: readonly MemoryDocPoint[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const point of points) for (const id of point.lines) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  return numbers;
}

/** Footnote numbers for the lines a document cites, in reading order. */
export function citationNumbers(doc: MemoryWikiDoc): Map<string, number> {
  return citationOrder(docPoints(doc));
}

/** The document as Markdown, with its cited lines as footnotes, for copying into notes or other tools. */
export function docMarkdown(page: MemoryWikiPage, doc: MemoryWikiDoc, describe: (line: MemoryWikiLine) => string, pages: readonly MemoryWikiPage[] = [page]): string {
  const numbers = citationNumbers(doc);
  const cite = (point: MemoryDocPoint) => point.text + point.lines.map((id) => "[^" + numbers.get(id) + "]").join("");
  const parts = ["# " + page.title, ""];
  if (doc.summary.length > 0) parts.push(doc.summary.map(cite).join(" "), "");
  for (const section of doc.sections) parts.push("## " + section.heading, ...section.points.map((point) => "- " + cite(point)), "");
  // A person's or topic's document may cite what other pages say about it.
  const byId = new Map([page, ...pages].flatMap((item) => item.lines.map((line) => [line.id, line] as const)));
  for (const [id, number] of numbers) {
    const line = byId.get(id);
    if (line) parts.push("[^" + number + "]: " + describe(line));
  }
  return parts.join("\n").trim() + "\n";
}

export type NumberedEntry = { readonly entry: WikiEntry; readonly number: number | null; readonly page: MemoryWikiPage };

/**
 * A page's current memories as its document sees them: the ones it was
 * written from, cited ones first in footnote order, and the ones that arrived
 * after it was written. A person's or topic's document may also cite lines of
 * other pages that name it; those join the evidence with the page they are on.
 * Without a document every memory counts as written.
 */
export function docEvidence(page: MemoryWikiPage, pages: readonly MemoryWikiPage[] = [page]): { readonly written: NumberedEntry[]; readonly pending: WikiEntry[] } {
  const { current } = pageEntries(page);
  if (!page.doc) return { written: current.map((entry) => ({ entry, number: null, page })), pending: [] };
  const numbers = citationNumbers(page.doc);
  const pendingIds = new Set(page.doc.pendingLineIds);
  // A document may cite the version a memory replaced since; the memory keeps that number.
  const numberOf = (entry: WikiEntry) => [entry.line, ...entry.history].reduce<number | null>((low, line) => {
    const number = numbers.get(line.id);
    return number === undefined ? low : low === null ? number : Math.min(low, number);
  }, null);
  const written: NumberedEntry[] = current.filter((entry) => !pendingIds.has(entry.line.id)).map((entry) => ({ entry, number: numberOf(entry), page }));
  const own = new Set(page.lines.map((line) => line.id));
  const seen = new Set(written.map((item) => item.entry.line.id));
  for (const [id] of numbers) {
    if (own.has(id)) continue;
    const found = findEntry(pages.filter((item) => item.id !== page.id), id);
    if (!found || seen.has(found.entry.line.id)) continue;
    seen.add(found.entry.line.id);
    written.push({ entry: found.entry, number: numberOf(found.entry), page: found.page });
  }
  const order = (item: NumberedEntry) => item.number ?? Number.MAX_SAFE_INTEGER;
  return { written: written.sort((a, b) => order(a) - order(b)), pending: current.filter((entry) => pendingIds.has(entry.line.id)) };
}
