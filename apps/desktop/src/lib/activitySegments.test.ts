import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { latestActivitySegmentCursor, selectActivitySegment } from "./activitySegments";
import { loadActivityRevisionFixture } from "../test/activityRevisionFixture";

const segment = (id: string, endedAt: string): ActivitySegment => ({
  id, startedAt: endedAt, endedAt, durationSeconds: 5,
  appName: "Synthetic QA", platform: "windows", source: "accessibility",
});

describe("latestActivitySegmentCursor", () => {
  it("advances the insertion cursor independently of wall time after a clock correction", () => {
    expect(latestActivitySegmentCursor([
      segment("1", "2026-10-03T12:00:00Z"),
      segment("9", "2026-10-03T11:30:40Z"),
      segment("2", "2026-10-03T11:30:05Z"),
    ])).toEqual({ afterSegmentId: "9", afterEndedAt: "2026-10-03T12:00:00Z" });
  });

  it("keeps chronological extension detection while an older interval gets a new id", () => {
    expect(latestActivitySegmentCursor([
      segment("2", "2026-10-03T12:10:00Z"),
      segment("100", "2026-10-03T08:00:00Z"),
    ])).toEqual({ afterSegmentId: "100", afterEndedAt: "2026-10-03T12:10:00Z" });
  });

  it("preserves empty, same-time, and preview cursors", () => {
    expect(latestActivitySegmentCursor([])).toEqual({ afterSegmentId: null, afterEndedAt: null });
    expect(latestActivitySegmentCursor([
      segment("2", "2026-10-03T12:00:00Z"),
      segment("3", "2026-10-03T12:00:00Z"),
    ])).toEqual({ afterSegmentId: "3", afterEndedAt: "2026-10-03T12:00:00Z" });
    expect(latestActivitySegmentCursor([
      segment("preview-one", "2026-10-03T12:00:00Z"),
      segment("preview-two", "2026-10-03T13:00:00Z"),
    ])).toEqual({ afterSegmentId: "preview-two", afterEndedAt: "2026-10-03T13:00:00Z" });
  });
});

describe("selectActivitySegment", () => {
  it("preserves actual SQLite trims and synced classification removals across full, compact and live copies", () => {
    const fixtures = loadActivityRevisionFixture();
    for (const [kind, pair] of Object.entries(fixtures)) {
      for (const older of Object.values(pair.before)) {
        for (const newer of Object.values(pair.after)) {
          expect(newer.revision).toBeGreaterThan(older.revision!);
          expect(selectActivitySegment(older, newer)).toBe(newer);
          expect(selectActivitySegment(newer, older)).toBe(newer);
          if (kind === "trim") expect(newer.durationSeconds).toBe(60);
          else expect(newer.classification).toBeUndefined();
        }
      }
    }
  });

  const revisedSegment = (
    id: string,
    endedAt: string,
    durationSeconds: number,
    revision: number,
  ): ActivitySegment & { readonly revision: number } => ({
    id,
    startedAt: "2026-10-03T12:00:00Z",
    endedAt,
    durationSeconds,
    appName: "Drifty",
    platform: "macos",
    source: "nsworkspace",
    revision,
  });

  it("accepts a shorter row only when its local revision is strictly newer", () => {
    const long = revisedSegment("1", "2026-10-03T12:03:05Z", 185, 37);
    const trimmed = revisedSegment("1", "2026-10-03T12:01:00Z", 60, 38);

    expect(selectActivitySegment(long, trimmed)).toBe(trimmed);
    expect(selectActivitySegment(trimmed, long)).toBe(trimmed);
  });

  it("does not resurrect a classification deleted by a newer row revision", () => {
    const classified = {
      ...revisedSegment("1", "2026-10-03T12:01:00Z", 60, 38),
      classification: {
        category: "workspace" as const,
        productivity: "focus" as const,
        source: "manual" as const,
        confidence: 1,
      },
    };
    const classificationDeleted = revisedSegment("1", "2026-10-03T12:01:00Z", 60, 39);

    expect(selectActivitySegment(classified, classificationDeleted)).toBe(classificationDeleted);
    expect(selectActivitySegment(classified, classificationDeleted).classification).toBeUndefined();
  });

  it("keeps completeness and legacy end-time fallback for equal or missing revisions", () => {
    const classified = {
      ...revisedSegment("1", "2026-10-03T12:01:00Z", 60, 38),
      classification: {
        category: "workspace" as const,
        productivity: "focus" as const,
        source: "manual" as const,
        confidence: 1,
      },
    };
    const equalRevisionProjection = revisedSegment("1", "2026-10-03T12:01:00Z", 60, 38);
    const legacyLong = segment("legacy", "2026-10-03T12:03:05Z");
    const legacyShort = segment("legacy", "2026-10-03T12:01:00Z");

    expect(selectActivitySegment(classified, equalRevisionProjection).classification).toEqual(classified.classification);
    expect(selectActivitySegment(legacyLong, legacyShort)).toBe(legacyLong);
  });
});
