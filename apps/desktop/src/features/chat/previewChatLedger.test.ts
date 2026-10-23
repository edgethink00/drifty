import { describe, expect, it } from "vitest";

import { buildPreviewChatLedger } from "./previewChatLedger";

describe("synthetic records for the browser preview Chat", () => {
  const now = new Date(2026, 9, 24, 14, 0);
  const { segments } = buildPreviewChatLedger(now);

  it("covers recent days and never records the future", () => {
    const days = new Set(segments.map((segment) => segment.start.slice(0, 10)));
    expect(days.size).toBe(10);
    expect(segments.every((segment) => new Date(segment.end).getTime() <= now.getTime())).toBe(true);
    expect(segments.every((segment) => new Date(segment.start).getTime() < new Date(segment.end).getTime())).toBe(true);
  });

  it("uses unique ids and the eval ledger's fields", () => {
    expect(new Set(segments.map((segment) => segment.id)).size).toBe(segments.length);
    for (const segment of segments) {
      expect(segment.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
      expect(["focus", "drift", "other"]).toContain(segment.productivity);
    }
    expect(segments.some((segment) => segment.project === "Drifty")).toBe(true);
  });
});

