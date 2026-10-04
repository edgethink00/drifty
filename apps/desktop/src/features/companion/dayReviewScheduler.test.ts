import { describe, expect, it } from "vitest";
import {
  DAY_REVIEW_LEGACY_STORAGE_KEYS,
  DAY_REVIEW_RECORD_STORAGE_KEY,
  acknowledgeDayReview,
  appendDayReviewDecision,
  closeDayReview,
  createDayReviewRecord,
  isDayReviewUserActive,
  readDayReviewDecisionLog,
  readDayReviewRecord,
  recordDayReviewPresentation,
  recordDayReviewUnseen,
  resolveDayReviewDecision,
  resolveDayReviewWindow,
  revertDayReviewPresentation,
  type DayReviewDecisionInput,
  type DayReviewRecord,
} from "./dayReviewScheduler";
import { END_OF_DAY_REVIEW_STORAGE_KEY } from "./endOfDayReviewData";

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

const DAY = "2026-10-03";
const START_OF_DAY = 4 * 60;
const REVIEW_MINUTE = 20 * 60;
const at = (year: number, month: number, date: number, hour: number, minute = 0) =>
  new Date(year, month - 1, date, hour, minute, 0, 0).getTime();

function input(overrides: Partial<DayReviewDecisionInput> = {}): DayReviewDecisionInput {
  return {
    nowMs: at(2026, 10, 3, 20, 5),
    day: DAY,
    reviewMinute: REVIEW_MINUTE,
    startOfDayMinutes: START_OF_DAY,
    enabled: true,
    previewSurface: false,
    installDayEligible: true,
    quietHoursActive: false,
    userActive: true,
    trackedSeconds: 4 * 3600,
    record: null,
    ...overrides,
  };
}

describe("dayReviewScheduler window", () => {
  it("opens at the review time and closes two hours before the logical day ends", () => {
    const window = resolveDayReviewWindow(DAY, REVIEW_MINUTE, START_OF_DAY);
    expect(window.startMs).toBe(at(2026, 10, 3, 20));
    expect(window.endMs).toBe(at(2026, 10, 4, 2));
  });

  it("keeps at least an hour when the review time sits in the last hours of the day", () => {
    /* Midnight day start, 23:30 review: 22:00 would be before the review time. */
    const window = resolveDayReviewWindow(DAY, 23 * 60 + 30, 0);
    expect(window.startMs).toBe(at(2026, 10, 3, 23, 30));
    expect(window.endMs).toBe(at(2026, 10, 4, 0));
  });

  it("places a review clock earlier than the day start on the following calendar date", () => {
    const window = resolveDayReviewWindow(DAY, 15 * 60, 17 * 60);
    expect(window.startMs).toBe(at(2026, 10, 4, 15));
    /* The day ends at 17:00; two hours before is the start itself, so the one-hour floor applies. */
    expect(window.endMs).toBe(at(2026, 10, 4, 16));
  });
});

describe("dayReviewScheduler decision", () => {
  it("presents inside the window once the day has three tracked hours", () => {
    expect(resolveDayReviewDecision(input())).toEqual({ action: "present", reason: "due" });
  });

  it("waits before the review time and after the user turned the review off", () => {
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 3, 19, 59) })))
      .toEqual({ action: "wait", reason: "before_window" });
    expect(resolveDayReviewDecision(input({ enabled: false })))
      .toEqual({ action: "wait", reason: "disabled" });
  });

  it("waits for a thin day and keeps re-evaluating until the bar is crossed", () => {
    expect(resolveDayReviewDecision(input({ trackedSeconds: 3 * 3600 - 1 })))
      .toEqual({ action: "wait", reason: "thin_day" });
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 3, 23, 40), trackedSeconds: 3 * 3600 })))
      .toEqual({ action: "present", reason: "due" });
    /* Work after midnight still belongs to the logical day. */
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 4, 1, 30) })))
      .toEqual({ action: "present", reason: "due" });
  });

  it("closes the day when the window ends, whatever state it was in", () => {
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 4, 2) })))
      .toEqual({ action: "close", reason: "window_ended" });
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 4, 2), trackedSeconds: 0 })))
      .toEqual({ action: "close", reason: "window_ended" });
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 4, 3), enabled: false })))
      .toEqual({ action: "close", reason: "window_ended" });
  });

  it("never carries a review into the next day", () => {
    /* 12:44 the next day: the record is for the new logical day, and it waits
       for its own evening. Yesterday is not consulted at all. */
    expect(resolveDayReviewDecision(input({ nowMs: at(2026, 10, 4, 12, 44), day: "2026-10-04" })))
      .toEqual({ action: "wait", reason: "before_window" });
  });

  it("waits while the user is away or quiet hours are active", () => {
    expect(resolveDayReviewDecision(input({ userActive: false })))
      .toEqual({ action: "wait", reason: "user_idle" });
    expect(resolveDayReviewDecision(input({ quietHoursActive: true })))
      .toEqual({ action: "wait", reason: "quiet_hours" });
  });

  it("needs the tracked total before it can present", () => {
    expect(resolveDayReviewDecision(input({ trackedSeconds: null })))
      .toEqual({ action: "wait", reason: "tracked_unknown" });
  });

  it("closes a late-install day and does nothing on preview surfaces", () => {
    expect(resolveDayReviewDecision(input({ installDayEligible: false })))
      .toEqual({ action: "close", reason: "install_day" });
    expect(resolveDayReviewDecision(input({ previewSurface: true })))
      .toEqual({ action: "none", reason: "preview_surface" });
  });

  it("waits for the acknowledgement of a delivered card and rebuilds an unseen one once", () => {
    const presented: DayReviewRecord = {
      ...createDayReviewRecord(DAY),
      status: "presented",
      presentations: 1,
      lastPresentedAt: new Date(at(2026, 10, 3, 20)).toISOString(),
    };
    expect(resolveDayReviewDecision(input({ record: presented })))
      .toEqual({ action: "wait", reason: "awaiting_acknowledgement" });
    expect(resolveDayReviewDecision(input({ record: { ...presented, expiredUnseen: true } })))
      .toEqual({ action: "present", reason: "retry_after_unseen" });
    expect(resolveDayReviewDecision(input({ record: { ...presented, expiredUnseen: true, presentations: 2 } })))
      .toEqual({ action: "close", reason: "presentation_limit" });
  });

  it("is finished once acknowledged or closed", () => {
    const acknowledged: DayReviewRecord = { ...createDayReviewRecord(DAY), status: "acknowledged" };
    expect(resolveDayReviewDecision(input({ record: acknowledged })))
      .toEqual({ action: "none", reason: "already_acknowledged" });
    const closed: DayReviewRecord = { ...createDayReviewRecord(DAY), status: "closed", closedReason: "window_ended" };
    expect(resolveDayReviewDecision(input({ record: closed })))
      .toEqual({ action: "none", reason: "already_closed" });
  });

  it("treats a recently active user, or one without idle detection, as present", () => {
    expect(isDayReviewUserActive({ idleSeconds: 30, idleDetectionAvailable: true })).toBe(true);
    expect(isDayReviewUserActive({ idleSeconds: 121, idleDetectionAvailable: true })).toBe(false);
    expect(isDayReviewUserActive({ idleSeconds: 999, idleDetectionAvailable: false })).toBe(true);
    expect(isDayReviewUserActive({ idleSeconds: null, idleDetectionAvailable: true })).toBe(true);
  });
});

describe("dayReviewScheduler record", () => {
  it("moves through presented, acknowledged and closed, and ignores other days", () => {
    const storage = memoryStorage();
    expect(readDayReviewRecord(DAY, storage)).toBeNull();
    recordDayReviewPresentation(DAY, "2026-10-03T11:00:00.000Z", storage);
    expect(readDayReviewRecord(DAY, storage)).toMatchObject({ status: "presented", presentations: 1 });
    expect(readDayReviewRecord("2026-10-04", storage)).toBeNull();
    acknowledgeDayReview(DAY, "2026-10-03T11:00:03.000Z", storage);
    expect(readDayReviewRecord(DAY, storage)).toMatchObject({ status: "acknowledged", acknowledgedAt: "2026-10-03T11:00:03.000Z" });
    /* A late close cannot undo an acknowledgement. */
    closeDayReview(DAY, "window_ended", storage);
    expect(readDayReviewRecord(DAY, storage)?.status).toBe("acknowledged");
  });

  it("marks an unseen card and reverts a dropped delivery without losing the attempt count", () => {
    const storage = memoryStorage();
    recordDayReviewPresentation(DAY, "2026-10-03T11:00:00.000Z", storage);
    recordDayReviewUnseen(DAY, storage);
    expect(readDayReviewRecord(DAY, storage)).toMatchObject({ status: "presented", expiredUnseen: true });
    recordDayReviewPresentation(DAY, "2026-10-03T11:20:00.000Z", storage);
    expect(readDayReviewRecord(DAY, storage)).toMatchObject({ status: "presented", presentations: 2, expiredUnseen: false });
    revertDayReviewPresentation(DAY, storage);
    expect(readDayReviewRecord(DAY, storage)).toMatchObject({ status: "pending", presentations: 2 });
  });

  it("keeps a v1 acknowledgement for the same day and clears the retired keys", () => {
    const storage = memoryStorage();
    storage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, DAY);
    storage.setItem("drifty.endOfDayReview.catchUpHandledDay", "2026-10-02");
    storage.setItem("drifty.endOfDayReview.presentations.v1", JSON.stringify({ [DAY]: 1 }));
    expect(readDayReviewRecord(DAY, storage)).toMatchObject({ status: "acknowledged" });
    for (const key of DAY_REVIEW_LEGACY_STORAGE_KEYS) expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(DAY_REVIEW_RECORD_STORAGE_KEY)).not.toBeNull();
  });

  it("drops v1 state for other days instead of reviving a catch-up", () => {
    const storage = memoryStorage();
    storage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, "2026-10-02");
    expect(readDayReviewRecord(DAY, storage)).toBeNull();
    expect(storage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY)).toBeNull();
  });

  it("logs a decision only when it changes", () => {
    const storage = memoryStorage();
    const entry = { at: "2026-10-03T11:00:00.000Z", day: DAY, action: "wait" as const, reason: "thin_day" as const, trackedSeconds: 100 };
    appendDayReviewDecision(entry, storage);
    appendDayReviewDecision({ ...entry, at: "2026-10-03T11:01:00.000Z" }, storage);
    appendDayReviewDecision({ ...entry, at: "2026-10-03T11:02:00.000Z", action: "present", reason: "due" }, storage);
    expect(readDayReviewDecisionLog(storage).map((item) => item.reason)).toEqual(["thin_day", "due"]);
  });
});

