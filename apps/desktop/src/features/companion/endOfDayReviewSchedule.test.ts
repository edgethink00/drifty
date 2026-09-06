import { describe, expect, it } from "vitest";
import {
  DEFAULT_END_OF_DAY_REVIEW_MINUTE,
  END_OF_DAY_REVIEW_MINUTE_OPTIONS,
  endOfDayReviewMinuteToValue,
  endOfDayReviewValueToMinute,
  isEndOfDayReviewDue,
  resolveEndOfDayReviewCatchUp,
  resolveInitialEndOfDayReviewMinute,
  snapEndOfDayReviewMinute,
} from "./endOfDayReviewSchedule";

function storageWith(value: string | null): Storage {
  return {
    getItem: () => value,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
}

describe("endOfDayReviewSchedule", () => {
  it("offers half-hour evening slots from 3 PM to 11:30 PM with 8 PM as default", () => {
    expect(END_OF_DAY_REVIEW_MINUTE_OPTIONS[0]).toEqual({ value: "15:00", minutes: 15 * 60 });
    expect(END_OF_DAY_REVIEW_MINUTE_OPTIONS[END_OF_DAY_REVIEW_MINUTE_OPTIONS.length - 1]).toEqual({
      value: "23:30",
      minutes: 23 * 60 + 30,
    });
    expect(END_OF_DAY_REVIEW_MINUTE_OPTIONS).toHaveLength(18);
    expect(DEFAULT_END_OF_DAY_REVIEW_MINUTE).toBe(20 * 60);
    expect(endOfDayReviewMinuteToValue(DEFAULT_END_OF_DAY_REVIEW_MINUTE)).toBe("20:00");
    expect(endOfDayReviewValueToMinute("18:30")).toBe(18 * 60 + 30);
    expect(endOfDayReviewValueToMinute("garbage")).toBe(DEFAULT_END_OF_DAY_REVIEW_MINUTE);
  });

  it("snaps stored minutes onto the offered slots", () => {
    expect(snapEndOfDayReviewMinute(18 * 60 + 10)).toBe(18 * 60);
    expect(snapEndOfDayReviewMinute(18 * 60 + 20)).toBe(18 * 60 + 30);
    expect(snapEndOfDayReviewMinute(9 * 60)).toBe(15 * 60);
    expect(snapEndOfDayReviewMinute(23 * 60 + 59)).toBe(23 * 60 + 30);
    expect(snapEndOfDayReviewMinute(Number.NaN)).toBe(DEFAULT_END_OF_DAY_REVIEW_MINUTE);
    expect(resolveInitialEndOfDayReviewMinute(storageWith(null))).toBe(DEFAULT_END_OF_DAY_REVIEW_MINUTE);
    expect(resolveInitialEndOfDayReviewMinute(storageWith("1110"))).toBe(18 * 60 + 30);
    expect(resolveInitialEndOfDayReviewMinute(storageWith("nope"))).toBe(DEFAULT_END_OF_DAY_REVIEW_MINUTE);
  });

  it("is due from the review minute until the logical day rolls over", () => {
    const startOfDay = 4 * 60;
    expect(isEndOfDayReviewDue(17 * 60 + 59, 18 * 60, startOfDay)).toBe(false);
    expect(isEndOfDayReviewDue(18 * 60, 18 * 60, startOfDay)).toBe(true);
    expect(isEndOfDayReviewDue(23 * 60 + 30, 18 * 60, startOfDay)).toBe(true);
    /* 1 AM is still the same logical day when the day starts at 4 AM. */
    expect(isEndOfDayReviewDue(1 * 60, 18 * 60, startOfDay)).toBe(true);
    expect(isEndOfDayReviewDue(4 * 60, 18 * 60, startOfDay)).toBe(false);
    /* With a midnight day start, 1 AM is the next day and nothing is due. */
    expect(isEndOfDayReviewDue(1 * 60, 18 * 60, 0)).toBe(false);
  });

  it("offers yesterday once when it was never shown", () => {
    expect(resolveEndOfDayReviewCatchUp({ todayDay: "2026-05-21", lastShownDay: null, catchUpHandledDay: null }))
      .toEqual({ day: "2026-05-20" });
    expect(resolveEndOfDayReviewCatchUp({ todayDay: "2026-05-21", lastShownDay: "2026-05-20", catchUpHandledDay: null }))
      .toBeNull();
    expect(resolveEndOfDayReviewCatchUp({ todayDay: "2026-05-21", lastShownDay: null, catchUpHandledDay: "2026-05-20" }))
      .toBeNull();
    /* Only yesterday: older gaps are history, not a card. */
    expect(resolveEndOfDayReviewCatchUp({ todayDay: "2026-05-21", lastShownDay: "2026-05-18", catchUpHandledDay: "2026-05-19" }))
      .toEqual({ day: "2026-05-20" });
  });
});
