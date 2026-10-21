// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewTimeline, resetPreviewMutations } from "./previewData";
import { buildPreviewTimelineCards } from "./previewTimelineCards";

describe("buildPreviewTimelineCards", () => {
  afterEach(() => {
    resetPreviewMutations();
    vi.useRealTimers();
  });

  it("gives every card details that name each of its records once, in its own language, as stored cards with details do", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T21:00:00"));
    const segments = previewTimeline({ start: "2026-06-25T04:00:00", end: "2026-07-01T04:00:00" });
    const records = buildPreviewTimelineCards(segments);
    expect(records.filter((record) => record.language === "ko")).toHaveLength(records.length / 2);
    expect(records.length).toBeGreaterThanOrEqual(40);
    for (const record of records) {
      for (const card of record.cards) {
        const details = card.details ?? [];
        expect(details.flatMap((detail) => detail.segmentIds).sort()).toEqual([...card.segmentIds].sort());
        expect(details.filter((detail) => detail.named)).toHaveLength(1);
        for (const detail of details) expect(detail.activity.trim()).not.toBe("");
      }
    }
    const inbox = (language: string) => records.find((record) => record.language === language && record.cards[0]?.title.match(/Inbox|받은편지함/u))?.cards[0]?.details?.[0]?.activity;
    expect(inbox("en")).toBe("Morning inbox replies");
    expect(inbox("ko")).toBe("아침 메일 확인과 답장");
  });
});
