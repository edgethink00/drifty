import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCompactDurationFromSeconds, formatDateRangeLabel, formatLocalizedDuration, formatRelativeTime } from "./formatting";

afterEach(() => {
  vi.useRealTimers();
});

describe("duration rounding", () => {
  it("carries 59.5 rounded minutes into the next hour in English and Korean", () => {
    expect(formatLocalizedDuration(2008770, "en")).toBe("558h");
    expect(formatLocalizedDuration(2008770, "ko")).toBe("558시간");
    expect(formatLocalizedDuration(3570, "en")).toBe("1h");
    expect(formatLocalizedDuration(7199, "en")).toBe("2h");
    expect(formatLocalizedDuration(5399, "en")).toBe("1h 30m");
    expect(formatCompactDurationFromSeconds(3599)).toBe("1h");
  });
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

describe("formatDateRangeLabel", () => {
  it("keeps weekday names on a single day", () => {
    expect(formatDateRangeLabel("2026-08-24", "2026-08-24")).toBe("Mon, Aug 24");
  });

  it("omits the repeated month inside the same month", () => {
    expect(formatDateRangeLabel("2026-08-24", "2026-08-30")).toBe("Aug 24–30");
  });

  it("keeps both months when the range crosses a month boundary", () => {
    expect(formatDateRangeLabel("2026-08-31", "2026-09-06")).toBe("Aug 31–Sep 6");
  });

  it("adds years only when the range crosses a year boundary", () => {
    expect(formatDateRangeLabel("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026–Jan 3, 2027");
  });

  it("keeps both months inside the same year", () => {
    expect(formatDateRangeLabel("2026-06-02", "2026-08-30")).toBe("Jun 2–Aug 30");
  });

  it("returns the raw ISO pair when a day cannot be parsed", () => {
    expect(formatDateRangeLabel("not-a-day", "2026-08-30")).toBe("not-a-day–2026-08-30");
  });
});
