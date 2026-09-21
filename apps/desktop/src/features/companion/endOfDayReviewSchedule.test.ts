import { describe, expect, it } from "vitest";
import {
  DEFAULT_END_OF_DAY_REVIEW_MINUTE,
  END_OF_DAY_REVIEW_MINUTE_OPTIONS,
  endOfDayReviewMinuteToValue,
  endOfDayReviewValueToMinute,
  END_OF_DAY_REVIEW_MAX_PRESENTATIONS_PER_DAY,
  END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY,
  endOfDayReviewDeadlineForDay,
  hasExhaustedEndOfDayReviewPresentations,
  isEndOfDayReviewDue,
  persistEndOfDayReviewLastPresentationDay,
  readEndOfDayReviewLastPresentationDay,
  readEndOfDayReviewPresentationCount,
  recordEndOfDayReviewPresentation,
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

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    clear: () => { entries.clear(); },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    get length() { return entries.size; },
  } as Storage;
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

  it("places a review earlier than the day start near the end of that logical day", () => {
    const startOfDay = 17 * 60;
    const reviewMinute = 15 * 60;
    expect(isEndOfDayReviewDue(17 * 60, reviewMinute, startOfDay)).toBe(false);
    expect(isEndOfDayReviewDue(23 * 60, reviewMinute, startOfDay)).toBe(false);
    expect(isEndOfDayReviewDue(14 * 60 + 59, reviewMinute, startOfDay)).toBe(false);
    expect(isEndOfDayReviewDue(15 * 60, reviewMinute, startOfDay)).toBe(true);
    expect(isEndOfDayReviewDue(16 * 60 + 59, reviewMinute, startOfDay)).toBe(true);
  });

  it("builds the catch-up delivery deadline from today's configured review time", () => {
    expect(endOfDayReviewDeadlineForDay("2026-05-21", 20 * 60, 4 * 60))
      .toBe(new Date(2026, 4, 21, 20, 0, 0, 0).toISOString());
    expect(endOfDayReviewDeadlineForDay("2026-05-21", 15 * 60, 17 * 60))
      .toBe(new Date(2026, 4, 22, 15, 0, 0, 0).toISOString());
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

  it("gives today's due review priority over yesterday's catch-up", () => {
    expect(resolveEndOfDayReviewCatchUp({
      todayDay: "2026-05-21",
      lastShownDay: null,
      catchUpHandledDay: null,
      lastPresentationDay: null,
      currentReviewDue: true,
    })).toBeNull();
  });

  it("does not offer another review after catch-up used today's interruption slot", () => {
    expect(resolveEndOfDayReviewCatchUp({
      todayDay: "2026-05-21",
      lastShownDay: null,
      catchUpHandledDay: null,
      lastPresentationDay: "2026-05-21",
      currentReviewDue: false,
    })).toBeNull();
  });

  it("persists the logical day on which a review was presented", () => {
    const storage = memoryStorage();

    expect(readEndOfDayReviewLastPresentationDay(storage)).toBeNull();
    persistEndOfDayReviewLastPresentationDay("2026-05-21", storage);

    expect(storage.getItem(END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY)).toBe("2026-05-21");
    expect(readEndOfDayReviewLastPresentationDay(storage)).toBe("2026-05-21");
  });
});

/* A display report that never arrives used to leave the day open forever, so
   the same review came back on every cooldown window until the logical day
   rolled over. */
describe("end-of-day review presentation ledger", () => {
  it("counts presentations per day, so today and yesterday do not evict each other", () => {
    const storage = memoryStorage();

    expect(readEndOfDayReviewPresentationCount("2026-05-20", storage)).toBe(0);
    expect(recordEndOfDayReviewPresentation("2026-05-20", storage)).toBe(1);
    expect(recordEndOfDayReviewPresentation("2026-05-20", storage)).toBe(2);
    expect(readEndOfDayReviewPresentationCount("2026-05-20", storage)).toBe(2);
    /* The allowance remains target-day-specific even though delivery
       arbitration prevents two visible cards in one logical day. */
    expect(readEndOfDayReviewPresentationCount("2026-05-21", storage)).toBe(0);
    expect(recordEndOfDayReviewPresentation("2026-05-21", storage)).toBe(1);
    expect(readEndOfDayReviewPresentationCount("2026-05-20", storage)).toBe(2);
  });

  it("closes a day once it spends its allowance without an acknowledgement", () => {
    const storage = memoryStorage();

    for (let attempt = 0; attempt < END_OF_DAY_REVIEW_MAX_PRESENTATIONS_PER_DAY - 1; attempt += 1) {
      recordEndOfDayReviewPresentation("2026-05-20", storage);
      expect(hasExhaustedEndOfDayReviewPresentations("2026-05-20", storage)).toBe(false);
    }
    recordEndOfDayReviewPresentation("2026-05-20", storage);

    expect(hasExhaustedEndOfDayReviewPresentations("2026-05-20", storage)).toBe(true);
    expect(hasExhaustedEndOfDayReviewPresentations("2026-05-21", storage)).toBe(false);
  });

  it("treats unreadable ledger content as an unused allowance", () => {
    expect(readEndOfDayReviewPresentationCount("2026-05-20", storageWith("not json"))).toBe(0);
    expect(readEndOfDayReviewPresentationCount("2026-05-20", storageWith('{"2026-05-20":"two"}'))).toBe(0);
    expect(readEndOfDayReviewPresentationCount("2026-05-20", storageWith('["2026-05-20"]'))).toBe(0);
    expect(hasExhaustedEndOfDayReviewPresentations("2026-05-20", storageWith(null))).toBe(false);
  });

  it("keeps the ledger small as days pass", () => {
    const storage = memoryStorage();
    for (const day of ["2026-05-16", "2026-05-17", "2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21"]) {
      recordEndOfDayReviewPresentation(day, storage);
    }

    const ledger = JSON.parse(storage.getItem("drifty.endOfDayReview.presentations.v1") ?? "{}") as Record<string, number>;

    expect(Object.keys(ledger)).toEqual(["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21"]);
  });
});
