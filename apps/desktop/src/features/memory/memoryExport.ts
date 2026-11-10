import { useEffect, useSyncExternalStore } from "react";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import {
  decodeExportResult, decodeWiki, type MemoryDocPoint, type MemoryWiki, type MemoryWikiLine, type MemoryWikiPage,
} from "../screen-context/memoryWire";
import { useLocalization } from "../localization/LocalizationContext";
import { memoryNotedOn } from "./memoryBeta";
import { appName, MEMORY_COPY, type MemoryCopy } from "./memoryCopy";
import { citationOrder, docMarkdown } from "./memoryWikiModel";

/**
 * Markdown copies of the work wiki, always kept with the rest of memory in the
 * profile's own folder inside Drifty's app data, so people who keep notes as
 * files (Obsidian, any editor or another AI tool) can open them. iCloud Drive
 * and OneDrive do not sync that folder and macOS asks no permission for it, so
 * the copies stay on this computer. Unlike the encrypted memory store they are
 * plain text, in a folder only this user account can open. Each page becomes
 * one file with its document, cited memories as footnotes and the person's own
 * note; "지금" and "나에 대해" get a file each. Original screens are never
 * written, and deleting everything in memory removes the files.
 */
const EVERY_MS = 5 * 60_000;
const MAX_NAME = 100;

export type MarkdownFile = { readonly name: string; readonly text: string };
export type MarkdownExportState = {
  readonly running: boolean; readonly lastAt: number | null; readonly files: number | null; readonly failed: boolean;
};

let state: MarkdownExportState = { running: false, lastAt: null, files: null, failed: false };
const listeners = new Set<() => void>();
function update(next: Partial<MarkdownExportState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useMarkdownExportState(): MarkdownExportState {
  return useSyncExternalStore(subscribe, () => state);
}

/** A plain file name for a page title: no folders, no hidden files, unique regardless of case. */
export function fileName(title: string, taken: Set<string>): string {
  let base = title.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[/\\:]/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  base = Array.from(base).slice(0, MAX_NAME).join("").trim() || "page";
  let name = base + ".md";
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = base + " (" + n + ").md";
  taken.add(name.toLowerCase());
  return name;
}

function describeWith(copy: MemoryCopy) {
  return (line: MemoryWikiLine) => line.text + " (" + appName(line.app) + ", " + copy.exact(line.observedAt) + ")";
}

/** A page as Markdown: its document with footnotes, or its memories when it has none, then the person's note. */
export function pageMarkdown(page: MemoryWikiPage, pages: readonly MemoryWikiPage[], copy: MemoryCopy): string {
  const describe = describeWith(copy);
  const body = page.doc
    ? docMarkdown(page, page.doc, describe, pages).trimEnd()
    : ["# " + page.title, "", ...page.lines.filter((line) => line.status === "current").map((line) => "- " + describe(line))].join("\n");
  const note = page.myNote ? ["", "## " + copy.myNote, "", page.myNote.text] : [];
  return [body, ...note].join("\n").trim() + "\n";
}

/** A written page of sections ("지금", "나에 대해") as Markdown, its cited memories as footnotes. */
function sectionsMarkdown(title: string, sections: readonly (readonly [string, readonly MemoryDocPoint[]])[], pages: readonly MemoryWikiPage[], copy: MemoryCopy): string {
  const shown = sections.filter(([, points]) => points.length > 0);
  const numbers = citationOrder(shown.flatMap(([, points]) => points));
  const cite = (point: MemoryDocPoint) => point.text + point.lines.map((id) => "[^" + numbers.get(id) + "]").join("");
  const parts = ["# " + title, ""];
  for (const [heading, points] of shown) parts.push("## " + heading, ...points.map((point) => "- " + cite(point)), "");
  const byId = new Map(pages.flatMap((page) => page.lines.map((line) => [line.id, line] as const)));
  const describe = describeWith(copy);
  for (const [id, number] of numbers) {
    const line = byId.get(id);
    if (line) parts.push("[^" + number + "]: " + describe(line));
  }
  return parts.join("\n").trim() + "\n";
}

/** Every file of an export, in a stable order so an unchanged wiki is not written again. */
export function wikiMarkdownFiles(wiki: MemoryWiki, copy: MemoryCopy): MarkdownFile[] {
  const taken = new Set<string>();
  const files: MarkdownFile[] = [];
  if (wiki.me) files.push({ name: fileName(copy.meTitle, taken), text: sectionsMarkdown(copy.meTitle,
    [[copy.meRole, wiki.me.role], [copy.meOwns, wiki.me.owns], [copy.mePeople, wiki.me.people]], wiki.pages, copy) });
  if (wiki.now) files.push({ name: fileName(copy.nowTitle, taken), text: sectionsMarkdown(copy.nowTitle,
    [[copy.nowDoing, wiki.now.doing], [copy.nowWaiting, wiki.now.waiting], [copy.nowDone, wiki.now.done]], wiki.pages, copy) });
  for (const page of [...wiki.pages].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
    files.push({ name: fileName(page.title, taken), text: pageMarkdown(page, wiki.pages, copy) });
  }
  return files;
}

let runner: (() => Promise<void>) | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;

/** Brings the folder up to date soon, for example after a page or note changed. */
export function requestMarkdownExport(): void {
  if (!runner) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => { pending = null; void runner?.(); }, 1500);
}

/** Removes the files an export wrote, as deleting everything in memory does. */
export async function clearMarkdownExport(client: ScreenContextClient): Promise<void> {
  lastWritten = null;
  await client.consume("memory_export_clear", {}, () => true, () => {});
  update({ lastAt: null, files: null, failed: false });
}

export function openMarkdownFolder(client: ScreenContextClient): Promise<void> {
  return client.consume("memory_export_open", {}, () => true, () => {});
}

/**
 * Rewrites the folder on start and every five minutes while memory is on, and
 * soon after a change made on the Memory page (the only way pages change while
 * memory is off). An unchanged wiki is not written. Someone who opened the beta
 * but never switched memory on is not polled.
 */
export function useMemoryMarkdownExport(client: ScreenContextClient | null): void {
  const { effectiveLanguage } = useLocalization();
  const copy = MEMORY_COPY[effectiveLanguage.startsWith("ko") ? "ko" : "en"];
  useEffect(() => {
    if (!client) return;
    let live = true;
    const run = async () => {
      if (!live || state.running) return;
      update({ running: true });
      try {
        let files: MarkdownFile[] = [];
        await client.consume("memory_wiki_pages", {}, decodeWiki, (wiki) => { files = wikiMarkdownFiles(wiki, copy); });
        const signature = JSON.stringify(files);
        if (signature !== lastWritten) {
          await client.consume("memory_export_markdown", { files }, decodeExportResult, () => {});
          lastWritten = signature;
        }
        if (live) update({ lastAt: Date.now(), files: files.length, failed: false });
      } catch (reason) {
        if (live && !(reason instanceof Error && reason.message === "screen_context_account_changed")) update({ failed: true });
      } finally {
        update({ running: false });
      }
    };
    runner = run;
    const tick = () => { if (memoryNotedOn()) void run(); };
    tick();
    const timer = setInterval(tick, EVERY_MS);
    return () => { live = false; clearInterval(timer); if (runner === run) runner = null; };
  }, [client, copy]);
}

