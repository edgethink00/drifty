/**
 * A drift card lives nine seconds. Whether it timed out or the user closed it,
 * one card per drift episode was the only nudge, so an episode that outlived
 * its card went quiet until the drift ended. The reminder ladder re-opens the
 * delivery path while the same episode continues: 3 minutes after the last
 * card, then 5, then every 10.
 *
 * The ladder is per episode and resets whenever the episode ends, a break
 * starts, or the user says the activity is not a drift. Anything that locks an
 * episode without a delivery (an AI gate suppress, an expired system-overlay
 * defer) never starts a ladder, so those locks keep their meaning.
 */
export const DRIFT_ALARM_REMINDER_INTERVALS_MS = [
  3 * 60 * 1000,
  5 * 60 * 1000,
  10 * 60 * 1000,
] as const;

export type DriftAlarmReminderState = {
  readonly episodeKey: string;
  readonly reminderCount: number;
  /** Null once a due reminder has been consumed and no card has followed. */
  readonly nextReminderAtMs: number | null;
};

export function driftAlarmReminderIntervalMs(reminderCount: number): number {
  const index = Math.min(
    Math.max(0, Math.floor(reminderCount)),
    DRIFT_ALARM_REMINDER_INTERVALS_MS.length - 1,
  );
  return DRIFT_ALARM_REMINDER_INTERVALS_MS[index];
}

/** A card was just shown for this episode: schedule the next reminder. */
export function scheduleDriftAlarmReminder(
  previous: DriftAlarmReminderState | null,
  episodeKey: string,
  nowMs: number,
): DriftAlarmReminderState {
  const reminderCount = previous?.episodeKey === episodeKey ? previous.reminderCount + 1 : 0;
  return {
    episodeKey,
    reminderCount,
    nextReminderAtMs: nowMs + driftAlarmReminderIntervalMs(reminderCount),
  };
}

export function isDriftAlarmReminderDue(
  state: DriftAlarmReminderState | null,
  episodeKey: string,
  nowMs: number,
): boolean {
  return state !== null
    && state.episodeKey === episodeKey
    && state.nextReminderAtMs !== null
    && nowMs >= state.nextReminderAtMs;
}

/**
 * A due reminder re-opens the delivery path once. Whatever that attempt
 * decides (a card, an AI-gate suppress, a deferred overlay), the ladder waits
 * for the next real card before it counts again, so a suppressed episode
 * never re-runs its gate every poll.
 */
export function consumeDriftAlarmReminder(state: DriftAlarmReminderState): DriftAlarmReminderState {
  return { ...state, nextReminderAtMs: null };
}
