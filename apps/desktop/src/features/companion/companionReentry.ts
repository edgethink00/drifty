import { isBrowserHistoryImportSegment, isRemoteDeviceSegment, type ActivitySegment } from "@drifty/domain";

export const COMPANION_REENTRY_MIN_GAP_MS = 6 * 60 * 60 * 1000;
export const COMPANION_REENTRY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const COMPANION_REENTRY_FRESHNESS_MS = 15 * 60 * 1000;
export const COMPANION_REENTRY_MIN_RETURN_ACTIVITY_MS = 30_000;
export const COMPANION_REENTRY_STORAGE_KEY = "drifty.companion.reentry.v1";

export type CompanionReentryEvent = {
  readonly kind: "reentry";
  readonly id: string;
  readonly awaySeconds: number;
  readonly lastActiveAt: string;
  readonly returnedAt: string;
  readonly title: string;
  readonly subtitle: string;
  readonly actionLabel: string;
};

/**
 * Find a real local-Mac return, rather than treating an app launch or OS wake
 * as proof that the user came back. The later segment must have started very
 * recently, and imported browser history or another synced Mac never counts.
 */
export function buildCompanionReentryEvent({
  segments,
  nowMs = Date.now(),
  locale,
}: {
  readonly segments: readonly ActivitySegment[];
  readonly nowMs?: number;
  readonly locale?: string;
}): CompanionReentryEvent | null {
  const localSegments = segments
    .filter(isObservedLocalMacActivity)
    .map((segment) => ({
      segment,
      startMs: Date.parse(segment.startedAt),
      endMs: Date.parse(segment.endedAt),
    }))
    .filter(({ startMs, endMs }) => Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  for (let returnIndex = localSegments.length - 1; returnIndex >= 0; returnIndex -= 1) {
    const returned = localSegments[returnIndex];
    const returnAgeMs = nowMs - returned.startMs;
    if (returnAgeMs < -60_000 || returnAgeMs > COMPANION_REENTRY_FRESHNESS_MS) continue;

    let previous: (typeof localSegments)[number] | null = null;
    for (let previousIndex = 0; previousIndex < returnIndex; previousIndex += 1) {
      const candidate = localSegments[previousIndex];
      if (candidate.endMs > returned.startMs) {
        previous = null;
        break;
      }
      if (previous === null || candidate.endMs > previous.endMs) previous = candidate;
    }
    if (!previous) continue;

    const awayMs = returned.startMs - previous.endMs;
    if (awayMs < COMPANION_REENTRY_MIN_GAP_MS || awayMs > COMPANION_REENTRY_LOOKBACK_MS) continue;

    /* A lid-open blip or a stray wake writes one tiny segment; that is the
       machine waking, not the person returning. Require sustained local
       activity at or after the candidate return, otherwise keep scanning so
       the real return later is still available. */
    let returnActivityMs = 0;
    for (const candidate of localSegments) {
      if (candidate.startMs < returned.startMs) continue;
      returnActivityMs += candidate.endMs - candidate.startMs;
    }
    if (returnActivityMs < COMPANION_REENTRY_MIN_RETURN_ACTIVITY_MS) continue;

    const awaySeconds = Math.floor(awayMs / 1000);
    const lastActiveAt = new Date(previous.endMs).toISOString();
    const returnedAt = new Date(returned.startMs).toISOString();
    const isKorean = locale?.toLowerCase().startsWith("ko") === true;
    return {
      kind: "reentry",
      id: `companion-reentry:${lastActiveAt}:${returnedAt}`,
      awaySeconds,
      lastActiveAt,
      returnedAt,
      title: isKorean
        ? `${formatKoreanReentryDuration(awaySeconds)} 만에 돌아왔어요`
        : `Back after ${formatReentryDuration(awaySeconds)}`,
      subtitle: formatLastActiveLabel(previous.endMs, awayMs, locale, isKorean),
      actionLabel: isKorean ? "마지막 기록 보기" : "See last session",
    };
  }

  return null;
}

export function formatReentryDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 1) return `${minutes}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function readHandledCompanionReentry(storage = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(COMPANION_REENTRY_STORAGE_KEY);
    return value?.startsWith("companion-reentry:") ? value : null;
  } catch {
    return null;
  }
}

export function persistHandledCompanionReentry(
  eventId: string,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(COMPANION_REENTRY_STORAGE_KEY, eventId);
  } catch {
    // A missing persistence layer may repeat a card, but must not block tracking.
  }
}

function isObservedLocalMacActivity(segment: ActivitySegment): boolean {
  return segment.platform === "macos"
    && segment.durationSeconds > 0
    && segment.appName.trim().length > 0
    && segment.source !== "manual"
    && !isBrowserHistoryImportSegment(segment)
    && !isRemoteDeviceSegment(segment);
}

function formatKoreanReentryDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 1) return `${minutes}분`;
  if (remainder === 0) return `${hours}시간`;
  return `${hours}시간 ${remainder}분`;
}

function formatLastActiveLabel(
  endedAtMs: number,
  awayMs: number,
  locale: string | undefined,
  isKorean: boolean,
): string {
  const date = new Date(endedAtMs);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (awayMs < 18 * 60 * 60 * 1000) {
    return isKorean ? `마지막 활동은 ${time}에 끝났어요` : `Last activity ended at ${time}`;
  }
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date);
  return isKorean
    ? `마지막 활동은 ${weekday} ${time}에 끝났어요`
    : `Last activity ended ${weekday} at ${time}`;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
