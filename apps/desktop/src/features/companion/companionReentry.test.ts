import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  buildCompanionReentryEvent,
  COMPANION_REENTRY_MIN_GAP_MS,
  formatReentryDuration,
  persistHandledCompanionReentry,
  readHandledCompanionReentry,
} from "./companionReentry";

const NOW = new Date(2026, 7, 5, 9, 30).getTime();

describe("companion re-entry", () => {
  it("turns a fresh local return after a long gap into an honest observation", () => {
    const event = buildCompanionReentryEvent({
      nowMs: NOW,
      locale: "en-US",
      segments: [
        segment("late-work", new Date(2026, 7, 5, 0, 55).getTime(), new Date(2026, 7, 5, 1, 18).getTime()),
        segment("morning", new Date(2026, 7, 5, 9, 28).getTime(), new Date(2026, 7, 5, 9, 29).getTime()),
      ],
    });

    expect(event).toMatchObject({
      kind: "reentry",
      awaySeconds: 8 * 3600 + 10 * 60,
      title: "Back after 8h 10m",
      subtitle: "Last activity ended at 1:18 AM",
      actionLabel: "See last session",
    });
  });

  it("localizes the observation without turning the gap into a sleep claim", () => {
    const event = buildCompanionReentryEvent({
      nowMs: NOW,
      locale: "ko-KR",
      segments: [
        segment("late-work", new Date(2026, 7, 5, 0, 55).getTime(), new Date(2026, 7, 5, 1, 18).getTime()),
        segment("morning", new Date(2026, 7, 5, 9, 28).getTime(), new Date(2026, 7, 5, 9, 29).getTime()),
      ],
    });

    expect(event?.title).toBe("8시간 10분 만에 돌아왔어요");
    expect(event?.subtitle).toContain("마지막 활동은");
    expect(event?.subtitle).not.toContain("수면");
    expect(event?.actionLabel).toBe("마지막 기록 보기");
  });

  it("finds the return segment even if the user already switched apps", () => {
    const returnStartedAt = new Date(2026, 7, 5, 9, 20).getTime();
    const event = buildCompanionReentryEvent({
      nowMs: NOW,
      locale: "en-US",
      segments: [
        segment("night", new Date(2026, 7, 4, 23, 0).getTime(), new Date(2026, 7, 5, 1, 0).getTime()),
        segment("finder", returnStartedAt, new Date(2026, 7, 5, 9, 22).getTime()),
        segment("mail", new Date(2026, 7, 5, 9, 22).getTime(), new Date(2026, 7, 5, 9, 29).getTime()),
      ],
    });

    expect(event?.returnedAt).toBe(new Date(returnStartedAt).toISOString());
    expect(event?.title).toBe("Back after 8h 20m");
  });

  it("rejects short, stale, imported, remote, and overlapping gaps", () => {
    const shortGap = COMPANION_REENTRY_MIN_GAP_MS - 1;
    const returnAt = NOW - 60_000;
    const previousEnd = returnAt - shortGap;
    expect(buildCompanionReentryEvent({
      nowMs: NOW,
      segments: [
        segment("previous", previousEnd - 60_000, previousEnd),
        segment("return", returnAt, NOW),
      ],
    })).toBeNull();

    expect(buildCompanionReentryEvent({
      nowMs: NOW,
      segments: [
        segment("previous", "2026-08-04T22:00:00.000Z", "2026-08-04T23:00:00.000Z"),
        segment("stale-return", "2026-08-05T08:00:00.000Z", "2026-08-05T08:30:00.000Z"),
      ],
    })).toBeNull();

    expect(buildCompanionReentryEvent({
      nowMs: NOW,
      segments: [
        segment("previous", "2026-08-04T22:00:00.000Z", "2026-08-04T23:00:00.000Z"),
        { ...segment("import", "2026-08-05T09:25:00.000Z", "2026-08-05T09:29:00.000Z"), source: "browser-history-import" },
        { ...segment("remote", "2026-08-05T09:26:00.000Z", "2026-08-05T09:29:00.000Z"), deviceId: "other-mac" },
      ],
    })).toBeNull();

    expect(buildCompanionReentryEvent({
      nowMs: NOW,
      segments: [
        segment("overnight-player", "2026-08-04T23:00:00.000Z", "2026-08-05T09:29:00.000Z"),
        segment("return", "2026-08-05T09:28:00.000Z", "2026-08-05T09:29:00.000Z"),
      ],
    })).toBeNull();
  });

  it("formats compact durations and persists only valid event identities", () => {
    expect(formatReentryDuration(8 * 3600 + 12 * 60)).toBe("8h 12m");
    expect(formatReentryDuration(6 * 3600)).toBe("6h");

    const storage = new MemoryStorage();
    expect(readHandledCompanionReentry(storage)).toBeNull();
    persistHandledCompanionReentry("companion-reentry:a:b", storage);
    expect(readHandledCompanionReentry(storage)).toBe("companion-reentry:a:b");
    storage.setItem("drifty.companion.reentry.v1", "not-an-event");
    expect(readHandledCompanionReentry(storage)).toBeNull();
  });
});

function segment(id: string, startedAt: string | number, endedAt: string | number): ActivitySegment {
  const startMs = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  const endMs = typeof endedAt === "number" ? endedAt : Date.parse(endedAt);
  return {
    id,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationSeconds: Math.max(1, Math.floor((endMs - startMs) / 1000)),
    appName: "Example",
    platform: "macos",
    source: "accessibility",
  };
}

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key: string) { return this.#values.get(key) ?? null; }
  key(index: number) { return Array.from(this.#values.keys())[index] ?? null; }
  removeItem(key: string) { this.#values.delete(key); }
  setItem(key: string, value: string) { this.#values.set(key, value); }
}
