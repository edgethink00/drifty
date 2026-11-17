import { describe, expect, it } from "vitest";
import { restoreCompactTimeline, type CompactTimelineMetadata, type CompactTimelinePayload } from "./compactTimeline";

const metadata: CompactTimelineMetadata = {
  youtubeCategory: "People & Blogs", youtubeChannelId: "synthetic", youtubeChannelName: "QA",
  youtubeTitle: "Video", youtubeDescription: "한글 😀 music\n\"\\\u0000",
  youtubeKeywords: ["lyrics", "노래"], youtubeDurationSeconds: 120, youtubeViewCount: 1,
  youtubeIsLive: false, youtubeIsUnlisted: true, youtubePublishDate: "2026-11-10", youtubeUploadDate: null,
};

function packet(): CompactTimelinePayload {
  return {
    items: [1, 2].map(id => ({
      id: String(id), startedAt: "2026-11-10T00:00:00Z", endedAt: "2026-11-10T00:01:00Z",
      durationSeconds: 60, appName: "QA browser", platform: "windows", source: "win32-foreground",
      youtubeVideoId: id === 1 ? null : "synthetic", youtubeMetadataIndex: 0,
    })),
    youtubeMetadata: [{ ...metadata }],
  };
}

describe("compact timeline decoding", () => {
  it("restores all enrichment values without exposing pool indexes or hidden lookup IDs", () => {
    const value = packet();
    const restored = restoreCompactTimeline(value);
    expect(restored).toEqual(value.items.map(({ youtubeMetadataIndex: _index, ...item }) => ({ ...item, ...metadata })));
    expect(restored[0].youtubeVideoId).toBeNull();
    expect(restored[1].youtubeVideoId).toBe("synthetic");
    expect(restored[0]).not.toHaveProperty("youtubeMetadataIndex");
    expect(restored[0].youtubeKeywords).toBe(restored[1].youtubeKeywords);
    expect(value.items[0]).toHaveProperty("youtubeMetadataIndex", 0);
  });

  it("does not let metadata overwrite identity, timing or classifications", () => {
    const value = packet();
    Object.assign(value.youtubeMetadata[0], { id: "wrong", startedAt: "wrong", classification: { category: "wrong" } });
    const row = restoreCompactTimeline(value)[0];
    expect(row.id).toBe("1");
    expect(row.startedAt).toBe("2026-11-10T00:00:00Z");
    expect(row.classification).toBeUndefined();
  });

  it.each([-1, 0.5, 1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid reference %s", (index) => {
    const value = packet();
    value.items[0].youtubeMetadataIndex = index;
    expect(() => restoreCompactTimeline(value)).toThrow("metadata reference");
  });

  it("rejects incomplete metadata instead of silently changing classification inputs", () => {
    const value = packet();
    Reflect.deleteProperty(value.youtubeMetadata[0], "youtubeDescription");
    expect(() => restoreCompactTimeline(value)).toThrow("Incomplete");
  });

  it("accepts an empty successful result and rejects malformed packet shapes", () => {
    expect(restoreCompactTimeline({ items: [], youtubeMetadata: [] })).toEqual([]);
    expect(() => restoreCompactTimeline({ items: [] } as unknown as CompactTimelinePayload)).toThrow("response");
  });
});
