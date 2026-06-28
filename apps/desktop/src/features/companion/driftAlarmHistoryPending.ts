import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";

export const BROWSER_HISTORY_CONTEXT_PENDING_WINDOW_MS = 3 * 60 * 1000;

export function isBrowserHistoryContextPendingForDriftAlarm(
  currentSnapshot: CurrentActivitySnapshot,
  segment: ActivitySegment,
): boolean {
  if (hasSiteContext(segment) || hasSiteContext(currentSnapshot)) return false;

  const historyStatus = segment.browserHistoryStatus ?? currentSnapshot.browserHistoryStatus ?? null;
  if (historyStatus !== "no_match") return false;
  if (!isRetryableBrowserHistoryWindowTitle(segment.windowTitle ?? currentSnapshot.windowTitle)) return false;

  const observedAtMs = Date.parse(currentSnapshot.observedAt);
  const startedAtMs = Date.parse(segment.startedAt);
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(startedAtMs) || observedAtMs < startedAtMs) return false;

  return observedAtMs - startedAtMs <= BROWSER_HISTORY_CONTEXT_PENDING_WINDOW_MS;
}

function hasSiteContext(value: ActivitySegment | CurrentActivitySnapshot): boolean {
  return Boolean(normalizeTitle(value.siteDomain) || normalizeTitle(value.siteTitle) || normalizeTitle(value.siteUrl));
}

function isRetryableBrowserHistoryWindowTitle(windowTitle?: string | null): boolean {
  const normalized = normalizeTitle(windowTitle);
  if (!normalized) return false;

  const firstPart = normalizeTitle(normalized.split(" - ", 1)[0]);
  return !GENERIC_HISTORY_WINDOW_TITLES.has(firstPart);
}

function normalizeTitle(value?: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^-+|-+$/g, "").trim();
}

const GENERIC_HISTORY_WINDOW_TITLES = new Set([
  "",
  "new tab",
  "새 탭",
  "dashboard",
  "inbox",
  "home",
  "untitled",
]);
