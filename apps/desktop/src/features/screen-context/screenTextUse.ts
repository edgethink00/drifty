import { activityTimeBounds, screenTextExcerpt, type ActivitySegment } from "@drifty/domain";
import type { ScreenContextClient } from "./screenContextClient";
import { activityEvidenceSelectionForStretch, type ActivityEvidenceSelection } from "./activityEvidenceSelection";

/**
 * Owner decision (2026-11-12): with screen recording on, the text Drifty reads from saved
 * screens also informs activity classification and automatic memory. One switch in AI
 * sending turns it off. Use starts once the person has been told: when they turn recording
 * on in this version, or after the one-line notice shown to someone whose recording was
 * already on.
 */
const SCREEN_TEXT_NOTICED_KEY = "drifty.screenText.noticed.v1";
export function screenTextNoticed(): boolean {
  try { return window.localStorage.getItem(SCREEN_TEXT_NOTICED_KEY) === "1"; } catch { return false; }
}
export function markScreenTextNoticed(): void {
  try { window.localStorage.setItem(SCREEN_TEXT_NOTICED_KEY, "1"); } catch { /* Without storage screen text simply stays unused. */ }
}

/** One classification batch; the native command refuses more. */
export const MAX_SCREEN_TEXT_ACTIVITIES = 20;
const SCREEN_TEXT_READ_TIMEOUT_MS = 5_000;
const INVALID = "screen_context_invalid_response";

/** Native answers one redacted text (at most 1,600 characters) or null per requested activity. */
export function decodeActivityTexts(raw: unknown, count: number): readonly (string | null)[] {
  if (!Array.isArray(raw) || raw.length !== count) throw new Error(INVALID);
  return raw.map((value) => {
    if (value === null) return null;
    if (typeof value !== "string" || value.length > 3200) throw new Error(INVALID);
    return value;
  });
}

/** Screen text excerpts by segment id; activities without readable saved screens are absent. */
export type ActivityScreenTextReader = (segments: readonly ActivitySegment[]) => Promise<ReadonlyMap<string, string>>;

type TextRequest = ActivityEvidenceSelection & { readonly segmentId: string };

/**
 * Reads each activity's latest recognized screen text through the current account grant.
 * Only an already connected recording is read: classification never binds the account itself,
 * waits at most a few seconds, and goes on without screen text on any failure.
 */
export function createActivityScreenTextReader(client: ScreenContextClient, timeoutMs = SCREEN_TEXT_READ_TIMEOUT_MS): ActivityScreenTextReader {
  return async (segments) => {
    if (!client.isDesktop() || client.getSnapshot().connection !== "ready") return new Map();
    const requests: TextRequest[] = [];
    for (const segment of segments) {
      if (requests.length >= MAX_SCREEN_TEXT_ACTIVITIES) break;
      const bounds = activityTimeBounds(segment);
      if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) continue;
      const selection = activityEvidenceSelectionForStretch([segment], Math.floor(bounds.start), Math.ceil(bounds.end));
      if (selection) requests.push({ segmentId: segment.id, ...selection });
    }
    if (requests.length === 0) return new Map();
    const texts = new Map<string, string>();
    let settled = false;
    const read = client.consume(
      "screen_context_activity_text",
      { activities: requests.map(({ recordIds, windows }) => ({ recordIds, windows })) },
      (raw) => decodeActivityTexts(raw, requests.length),
      (values) => {
        if (settled) return;
        values.forEach((value, index) => {
          const excerpt = value ? screenTextExcerpt(value) : undefined;
          if (excerpt) texts.set(requests[index].segmentId, excerpt);
        });
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    try {
      await Promise.race([read, timeout]);
    } catch {
      texts.clear();
    } finally {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      void read.catch(() => undefined);
    }
    return texts;
  };
}
