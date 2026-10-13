import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/api/shareCardClient";

export type WhatsNewPlatform = "macos" | "windows";
export type WhatsNewLanguage = "en" | "ko";

/** One chapter of the public drifty.so changelog. */
export type WhatsNewEntry = {
  /** Permalink anchor on drifty.so, for example "v1-12-4". */
  readonly id: string;
  /** Publication date, YYYY-MM-DD. */
  readonly date: string;
  /** Version label without the platform prefix: "v1.12.4" or "v1.11.17–1.11.21". */
  readonly label: string;
  readonly platforms: readonly WhatsNewPlatform[];
  readonly fromVersion: string;
  readonly toVersion: string;
  /** The chapter's one-line theme. */
  readonly summary: string;
  readonly items: readonly string[];
};

export const WHATS_NEW_CHANGELOG_URLS: Record<WhatsNewLanguage, string> = {
  en: "https://drifty.so/changelog/",
  ko: "https://drifty.so/ko/changelog/",
};

const CACHE_KEY_PREFIX = "drifty.whatsNew.changelogCache.v1:";
const VERSION = String.raw`\d+\.\d+\.\d+`;
const LABEL_PATTERN = new RegExp(String.raw`^(?:(Mac|Windows)\s+)?v(${VERSION})(?:\s*[–-]\s*(${VERSION}))?$`);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads "Mac v1.12.4", "Windows v1.12.3" or "v1.11.17–1.11.21". Chapters
 * without a platform predate separate Windows releases and apply to both.
 */
export function parseChangelogLabel(text: string) {
  const match = LABEL_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, platform, fromVersion, toVersion] = match;
  const platforms: readonly WhatsNewPlatform[] = platform === "Mac"
    ? ["macos"]
    : platform === "Windows" ? ["windows"] : ["macos", "windows"];
  return {
    platforms,
    fromVersion,
    toVersion: toVersion ?? fromVersion,
    label: toVersion ? `v${fromVersion}–${toVersion}` : `v${fromVersion}`,
  };
}

const textOf = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";

/** Extracts chapters as plain text. Markup from the page is never rendered. */
export function parseChangelogHtml(html: string): WhatsNewEntry[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const entries: WhatsNewEntry[] = [];
  for (const node of Array.from(document.querySelectorAll("li.release-entry"))) {
    const label = parseChangelogLabel(textOf(node.querySelector(".release-entry__versions")));
    const date = node.querySelector("time")?.getAttribute("datetime") ?? "";
    const summary = textOf(node.querySelector("article h3"));
    const items = Array.from(node.querySelectorAll("article ul > li")).map(textOf).filter(Boolean);
    if (!node.id || !label || !DATE_PATTERN.test(date) || !summary) continue;
    entries.push({ id: node.id, date, summary, items, ...label });
  }
  return entries;
}

type CachedChangelog = { readonly fetchedAt: string; readonly entries: readonly WhatsNewEntry[] };

function readCache(language: WhatsNewLanguage): readonly WhatsNewEntry[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + language);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedChangelog>;
    return Array.isArray(parsed.entries) && parsed.entries.length > 0 ? parsed.entries : null;
  } catch {
    return null;
  }
}

function writeCache(language: WhatsNewLanguage, entries: readonly WhatsNewEntry[]) {
  try {
    const value: CachedChangelog = { fetchedAt: new Date().toISOString(), entries };
    window.localStorage.setItem(CACHE_KEY_PREFIX + language, JSON.stringify(value));
  } catch {
    // A full or blocked storage only loses the offline copy.
  }
}

async function fetchChangelogHtml(language: WhatsNewLanguage): Promise<string | null> {
  if (isTauriRuntime()) return invoke<string | null>("whats_new_changelog_fetch", { language });
  const response = await fetch(WHATS_NEW_CHANGELOG_URLS[language]);
  return response.ok ? response.text() : null;
}

/**
 * Loads the changelog from drifty.so and keeps the last good copy for
 * offline use. Rejects only when neither the site nor the cache has entries.
 */
export async function loadWhatsNewChangelog(language: WhatsNewLanguage): Promise<readonly WhatsNewEntry[]> {
  try {
    const html = await fetchChangelogHtml(language);
    const entries = html ? parseChangelogHtml(html) : [];
    if (entries.length > 0) {
      writeCache(language, entries);
      return entries;
    }
  } catch {
    // Offline or blocked: fall back to the cached copy below.
  }
  const cached = readCache(language);
  if (cached) return cached;
  throw new Error("The changelog is unavailable.");
}
