import { isExcludedSegment, type SyncOutboxSegment } from "@drifty/domain";
import { minimizedActivityFields } from "../classification/aiClassificationService";
import type { AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";

/**
 * One recorded segment as an activity record (product decision 2026-10-26):
 * the fields a Drifty Cloud classification request carries for it under the
 * same AI privacy settings, plus its times and current classification, whoever
 * made it (built-in lists, YouTube rules, the user's rules or corrections, AI).
 */
export type ActivityRecordItem = {
  readonly segmentUid: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly utcOffsetMinutes: number;
  readonly platform: string;
  readonly captureSource: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName: string | null;
  readonly domain: string | null;
  readonly url: string | null;
  readonly windowTitle: string | null;
  readonly title: string | null;
  readonly youtubeChannelName: string | null;
  readonly youtubeCategory: string | null;
  readonly redditCommunity: string | null;
  readonly classification: {
    readonly category: string;
    readonly productivity: string;
    readonly source: string;
    readonly confidence: number | null;
    readonly classifiedAt: string | null;
  } | null;
};

export type ActivityRecordBatch = {
  readonly records: ActivityRecordItem[];
  /** Segments that are now excluded; any copy already sent is deleted. */
  readonly excludedSegmentUids: string[];
};

/**
 * Turns a page of the tracker's change feed into records. Only segments that
 * started at or after `since` (when sending began) leave the computer, so
 * earlier history and browser history imported from before are never sent.
 */
export function toActivityRecordBatch(
  segments: readonly SyncOutboxSegment[],
  since: string,
  privacySettings: AiPrivacyRequestSettings,
): ActivityRecordBatch {
  const sinceTime = Date.parse(since);
  const records: ActivityRecordItem[] = [];
  const excludedSegmentUids: string[] = [];
  for (const segment of segments) {
    const started = new Date(segment.startedAt);
    const ended = new Date(segment.endedAt);
    if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime()) || started.getTime() < sinceTime) continue;
    if (isExcludedSegment(segment)) {
      excludedSegmentUids.push(segment.segmentUid);
      continue;
    }
    const fields = minimizedActivityFields(segment, privacySettings);
    const classification = segment.classification;
    records.push({
      segmentUid: segment.segmentUid,
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      durationSeconds: Math.max(0, Math.round(segment.durationSeconds)),
      utcOffsetMinutes: -started.getTimezoneOffset(),
      platform: segment.platform,
      captureSource: segment.source,
      appName: fields.appName,
      bundleId: segment.bundleId ?? null,
      browserName: segment.browserName ?? null,
      domain: fields.siteDomain,
      url: fields.siteUrl,
      windowTitle: fields.windowTitle,
      title: fields.title,
      youtubeChannelName: fields.youtubeChannelName,
      youtubeCategory: fields.youtubeCategory,
      redditCommunity: fields.redditCommunity,
      classification: classification
        ? {
          category: classification.category,
          productivity: classification.productivity,
          source: classification.source,
          confidence: typeof classification.confidence === "number" ? classification.confidence : null,
          classifiedAt: classification.classifiedAt ?? null,
        }
        : null,
    });
  }
  return { records, excludedSegmentUids };
}
