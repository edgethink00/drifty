import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCompactDurationFromSeconds, formatDateRangeLabel, formatLocalizedDateRangeLabel, formatLocalizedDayLabel, formatLocalizedHourLabel, formatLocalizedCompactHourLabel, localeForDisplayLanguage, formatDeviceTimeZone, formatLocalizedCompactTimeRange, formatLocalizedDuration, formatLocalizedShortDurationFromSeconds, formatRelativeTime } from "./formatting";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the device region when Spanish is selected manually", () => {
  vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
  expect(localeForDisplayLanguage("es")).toBe("es-US");
  vi.stubGlobal("navigator", { language: "es-MX", languages: ["es-MX", "en-US"] });
  expect(localeForDisplayLanguage("es")).toBe("es-MX");
});

describe("device time zone label", () => {
  it("names the system zone with its UTC offset on the given date", () => {
    // The Vitest setup pins the process zone to Asia/Seoul (+9, no daylight saving).
    expect(formatDeviceTimeZone(new Date("2026-10-07T00:00:00Z"))).toBe("Asia/Seoul · GMT+9");
  });
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

  it("formats Spanish durations, recency and dates without English suffixes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T06:00:00.000Z"));
    expect(formatLocalizedDuration(5399, "es")).toBe("1 h 30 min");
    expect(formatRelativeTime("2026-08-29T05:55:00.000Z", "es")).toBe("hace 5 min");
    expect(formatLocalizedHourLabel(14, "es")).toBe("14:00");
    expect(formatLocalizedDayLabel("2026-08-24", "es")).toContain("ago");
    expect(formatLocalizedDateRangeLabel("2026-08-24", "2026-08-30", "es")).toBe("24–30 de agosto");
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

describe("formatLocalizedCompactTimeRange", () => {
  const at = (hour: number, minute: number) => new Date(2026, 9, 4, hour, minute);

  it("prints the meridiem once when both ends share it", () => {
    expect(formatLocalizedCompactTimeRange(at(1, 41), at(1, 48), "ko")).toBe("오전 1:41 – 1:48");
    expect(formatLocalizedCompactTimeRange(at(1, 41), at(1, 48), "en")).toBe("1:41 – 1:48 AM");
  });

  it("collapses to a single time when both ends land on the same minute", () => {
    expect(formatLocalizedCompactTimeRange(at(1, 49), at(1, 49), "ko")).toBe("오전 1:49");
    expect(formatLocalizedCompactTimeRange(at(1, 49), at(1, 49), "en")).toBe("1:49 AM");
  });

  it("keeps both meridiems when the range crosses noon or midnight", () => {
    expect(formatLocalizedCompactTimeRange(at(23, 58), at(0, 4), "ko")).toBe("오후 11:58 – 오전 12:04");
    expect(formatLocalizedCompactTimeRange(at(23, 58), at(0, 4), "en")).toBe("11:58 PM – 12:04 AM");
  });
});

describe("formatLocalizedShortDurationFromSeconds", () => {
  it("shows sub-minute durations as seconds instead of a rounded-down 0분", () => {
    expect(formatLocalizedShortDurationFromSeconds(28, "ko")).toBe("28초");
    expect(formatLocalizedShortDurationFromSeconds(54, "en")).toBe("54s");
  });

  it("keeps the compact minute format at a minute and beyond", () => {
    expect(formatLocalizedShortDurationFromSeconds(246, "ko")).toBe("4분");
    expect(formatLocalizedShortDurationFromSeconds(246, "en")).toBe("4m");
    expect(formatLocalizedShortDurationFromSeconds(3660, "ko")).toBe("1시간 1분");
  });

  it("never prints a rounded-up 60초", () => {
    expect(formatLocalizedShortDurationFromSeconds(59.6, "ko")).toBe("1분");
    expect(formatLocalizedShortDurationFromSeconds(59.6, "en")).toBe("1m");
  });
});

describe("compact chart hours", () => {
  it.each(["de", "zh-Hans"] as const)("keeps %s morning, afternoon and midnight distinct in a narrow rail", language => {
    const labels = [0, 1, 13, 23, 24, -1].map(hour => formatLocalizedCompactHourLabel(hour, language));
    expect(labels).toEqual(language === "de"
      ? ["0", "1", "13", "23", "0", "23"]
      : ["0时", "1时", "13时", "23时", "0时", "23时"]);
  });
});
