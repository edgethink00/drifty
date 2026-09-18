import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOURS,
  isWithinQuietHours,
  millisecondsUntilNextQuietHoursBoundary,
  normalizeQuietHours,
  quietHoursMinuteToValue,
  quietHoursValueToMinute,
} from "./quietHours";

describe("quietHours", () => {
  it("is never active while disabled", () => {
    expect(isWithinQuietHours(23 * 60, DEFAULT_QUIET_HOURS)).toBe(false);
  });

  it("covers a same-day window from start up to end", () => {
    const settings = { enabled: true, startMinute: 13 * 60, endMinute: 14 * 60 };
    expect(isWithinQuietHours(12 * 60 + 59, settings)).toBe(false);
    expect(isWithinQuietHours(13 * 60, settings)).toBe(true);
    expect(isWithinQuietHours(13 * 60 + 59, settings)).toBe(true);
    expect(isWithinQuietHours(14 * 60, settings)).toBe(false);
  });

  it("crosses midnight", () => {
    const settings = { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 };
    expect(isWithinQuietHours(21 * 60 + 59, settings)).toBe(false);
    expect(isWithinQuietHours(22 * 60, settings)).toBe(true);
    expect(isWithinQuietHours(23 * 60 + 59, settings)).toBe(true);
    expect(isWithinQuietHours(0, settings)).toBe(true);
    expect(isWithinQuietHours(7 * 60 + 59, settings)).toBe(true);
    expect(isWithinQuietHours(8 * 60, settings)).toBe(false);
  });

  it("keeps start and end distinct and snaps to half hours", () => {
    expect(normalizeQuietHours({ enabled: true, startMinute: 22 * 60, endMinute: 22 * 60 })).toEqual({
      enabled: true, startMinute: 22 * 60, endMinute: 22 * 60 + 30,
    });
    expect(normalizeQuietHours({ enabled: true, startMinute: 23 * 60 + 40, endMinute: 23 * 60 + 40 })).toEqual({
      enabled: true, startMinute: 23 * 60 + 30, endMinute: 0,
    });
    expect(normalizeQuietHours(null)).toEqual(DEFAULT_QUIET_HOURS);
    expect(normalizeQuietHours({ enabled: "yes" as unknown as boolean, startMinute: Number.NaN })).toEqual({
      enabled: false, startMinute: 0, endMinute: 8 * 60,
    });
  });

  it("round-trips select values", () => {
    expect(quietHoursMinuteToValue(22 * 60)).toBe("22:00");
    expect(quietHoursMinuteToValue(8 * 60 + 30)).toBe("08:30");
    expect(quietHoursValueToMinute("08:30", 0)).toBe(8 * 60 + 30);
    expect(quietHoursValueToMinute("nope", 42)).toBe(42);
  });

  it("schedules the next boundary, including across midnight", () => {
    const settings = { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60 };
    expect(millisecondsUntilNextQuietHoursBoundary(new Date(2026, 8, 18, 21, 59, 0, 0), settings)).toBe(60_000);
    expect(millisecondsUntilNextQuietHoursBoundary(new Date(2026, 8, 18, 23, 0, 0, 0), settings)).toBe(9 * 60 * 60 * 1000);
    // Exactly on a boundary, the next one is the other edge, never zero.
    expect(millisecondsUntilNextQuietHoursBoundary(new Date(2026, 8, 18, 22, 0, 0, 0), settings)).toBe(10 * 60 * 60 * 1000);
  });
});

