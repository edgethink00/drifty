import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "./formatting";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatRelativeTime", () => {
  it("keeps the existing compact English format by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T06:00:00.000Z"));

    expect(formatRelativeTime("2026-08-29T05:55:00.000Z")).toBe("5m ago");
  });

  it("formats tracker recency naturally in Korean", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T06:00:00.000Z"));

    expect(formatRelativeTime("2026-08-29T05:55:00.000Z", "ko-KR")).toBe("5분 전");
    expect(formatRelativeTime("not-a-date", "ko-KR")).toBe("알 수 없음");
  });
});
