import { describe, expect, it } from "vitest";
import {
  DRIFT_ALARM_REMINDER_INTERVALS_MS,
  consumeDriftAlarmReminder,
  driftAlarmReminderIntervalMs,
  isDriftAlarmReminderDue,
  scheduleDriftAlarmReminder,
} from "./driftAlarmReminder";

const EPISODE = "drift-episode:a";
const MINUTE = 60 * 1000;

describe("driftAlarmReminder", () => {
  it("climbs 3, 5, then repeats 10 minutes", () => {
    expect(DRIFT_ALARM_REMINDER_INTERVALS_MS).toEqual([3 * MINUTE, 5 * MINUTE, 10 * MINUTE]);
    expect(driftAlarmReminderIntervalMs(0)).toBe(3 * MINUTE);
    expect(driftAlarmReminderIntervalMs(1)).toBe(5 * MINUTE);
    expect(driftAlarmReminderIntervalMs(2)).toBe(10 * MINUTE);
    expect(driftAlarmReminderIntervalMs(7)).toBe(10 * MINUTE);
  });

  it("counts successive cards of the same episode up the ladder", () => {
    const first = scheduleDriftAlarmReminder(null, EPISODE, 0);
    expect(first).toEqual({ episodeKey: EPISODE, reminderCount: 0, nextReminderAtMs: 3 * MINUTE });

    const second = scheduleDriftAlarmReminder(first, EPISODE, 3 * MINUTE);
    expect(second.reminderCount).toBe(1);
    expect(second.nextReminderAtMs).toBe(8 * MINUTE);

    const third = scheduleDriftAlarmReminder(second, EPISODE, 8 * MINUTE);
    expect(third.nextReminderAtMs).toBe(18 * MINUTE);

    const fourth = scheduleDriftAlarmReminder(third, EPISODE, 18 * MINUTE);
    expect(fourth.reminderCount).toBe(3);
    expect(fourth.nextReminderAtMs).toBe(28 * MINUTE);
  });

  it("starts over when a different episode delivers", () => {
    const state = scheduleDriftAlarmReminder(
      { episodeKey: EPISODE, reminderCount: 2, nextReminderAtMs: null },
      "drift-episode:b",
      100,
    );
    expect(state).toEqual({ episodeKey: "drift-episode:b", reminderCount: 0, nextReminderAtMs: 100 + 3 * MINUTE });
  });

  it("is due only for the same episode at or after its deadline", () => {
    const state = scheduleDriftAlarmReminder(null, EPISODE, 0);
    expect(isDriftAlarmReminderDue(state, EPISODE, 3 * MINUTE - 1)).toBe(false);
    expect(isDriftAlarmReminderDue(state, EPISODE, 3 * MINUTE)).toBe(true);
    expect(isDriftAlarmReminderDue(state, "drift-episode:b", 3 * MINUTE)).toBe(false);
    expect(isDriftAlarmReminderDue(null, EPISODE, 3 * MINUTE)).toBe(false);
  });

  it("fires once per due reminder until the next card reschedules it", () => {
    const state = scheduleDriftAlarmReminder(null, EPISODE, 0);
    const consumed = consumeDriftAlarmReminder(state);
    expect(isDriftAlarmReminderDue(consumed, EPISODE, 60 * MINUTE)).toBe(false);
    expect(consumed.reminderCount).toBe(0);

    const rescheduled = scheduleDriftAlarmReminder(consumed, EPISODE, 4 * MINUTE);
    expect(rescheduled.reminderCount).toBe(1);
    expect(rescheduled.nextReminderAtMs).toBe(9 * MINUTE);
  });
});
