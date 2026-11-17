import type { ActivitySegment } from "./activity";

/** Shared enrichment. These values still participate in classification. */
export const compactTimelineMetadataKeys = [
  "youtubeCategory", "youtubeChannelId", "youtubeChannelName", "youtubeTitle",
  "youtubeDescription", "youtubeKeywords", "youtubeDurationSeconds", "youtubeViewCount",
  "youtubeIsLive", "youtubeIsUnlisted", "youtubePublishDate", "youtubeUploadDate",
] as const satisfies readonly (keyof ActivitySegment)[];

export type CompactTimelineMetadata = {
  [K in typeof compactTimelineMetadataKeys[number]]-?: Exclude<ActivitySegment[K], undefined> | null;
};

export interface CompactTimelinePayload {
  items: (Omit<ActivitySegment, keyof CompactTimelineMetadata> & { youtubeMetadataIndex: number })[];
  youtubeMetadata: CompactTimelineMetadata[];
}

/** Restore exact values with shared references, without re-encoding metadata. */
export function restoreCompactTimeline(payload: CompactTimelinePayload): ActivitySegment[] {
  if (!payload || !Array.isArray(payload.items) || !Array.isArray(payload.youtubeMetadata)) {
    throw new Error("Invalid compact timeline response");
  }
  return payload.items.map((item) => {
    const index = item?.youtubeMetadataIndex;
    if (!Number.isSafeInteger(index) || index < 0 || index >= payload.youtubeMetadata.length) {
      throw new Error("Invalid compact timeline metadata reference");
    }
    const metadata = payload.youtubeMetadata[index];
    if (!metadata || compactTimelineMetadataKeys.some(key => !Object.prototype.hasOwnProperty.call(metadata, key))) {
      throw new Error("Incomplete compact timeline metadata");
    }
    const { youtubeMetadataIndex: _index, ...segment } = item;
    // Copy only contract fields: enrichment cannot overwrite identity/timing.
    const fields = Object.fromEntries(compactTimelineMetadataKeys.map(key => [key, metadata[key]])) as CompactTimelineMetadata;
    return { ...segment, ...fields };
  });
}
