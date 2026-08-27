import type { ActivityCategory } from "@drifty/domain";
import type { DriftAlarmEvent } from "./driftAlarmEvent";

export const DRIFT_ALARM_INTERACTION_STORAGE_KEY = "drifty.companion.driftAlarmInteractions.v1";
export const BREAK_ASSESSMENT_WINDOW_MS = 10 * 60 * 1000;
export const INTERACTION_LOG_LIMIT = 500;

export type DriftAlarmActionName = "return_to_focus" | "start_break" | "manual_correction" | "settings" | "dismiss";
export type BreakRecoveryOutcome = "recovered" | "same_drift_continued" | "drift_shifted" | "unknown";

export type DriftAlarmRecoverySource = {
  readonly kind: "site" | "app" | "context";
  readonly key: string;
  readonly label: string;
  readonly category: ActivityCategory | null;
};

export type DriftAlarmBreakAttempt = {
  readonly attemptId: string;
  readonly alarmId: string;
  readonly mode: DriftAlarmEvent["mode"];
  readonly minutes: number;
  readonly breakStartedAt: string;
  readonly breakEndsAt: string;
  readonly assessmentEndsAt: string;
  readonly source: DriftAlarmRecoverySource;
};

export type DriftAlarmBreakSnooze = DriftAlarmBreakAttempt & {
  readonly untilMs: number;
  readonly pausedFromLabel: string;
  readonly focusTargets: DriftAlarmEvent["focusTargets"];
};

export type DriftAlarmShownInteraction = {
  readonly kind: "shown";
  readonly alarmId: string;
  readonly mode: DriftAlarmEvent["mode"];
  readonly shownAt: string;
  readonly driftDurationSeconds: number;
};

export type DriftAlarmActionInteraction = {
  readonly kind: "action";
  readonly alarmId: string;
  readonly mode: DriftAlarmEvent["mode"];
  readonly action: DriftAlarmActionName;
  readonly minutes?: number;
  readonly actedAt: string;
};

export type DriftAlarmBreakOutcomeInteraction = {
  readonly kind: "break_outcome";
  readonly alarmId: string;
  readonly attemptId: string;
  readonly minutes: number;
  readonly outcome: BreakRecoveryOutcome;
  readonly sourceLabel: string;
  readonly resolvedAt: string;
};

export type DriftAlarmInteraction =
  | DriftAlarmShownInteraction
  | DriftAlarmActionInteraction
  | DriftAlarmBreakOutcomeInteraction;

export type BreakRecoveryInsight = {
  readonly actionCounts: Record<DriftAlarmActionName, number>;
  readonly outcomeCounts: Record<BreakRecoveryOutcome, number>;
  readonly recoveryRate: number | null;
  readonly resolvedBreaks: number;
  readonly totalBreaks: number;
  readonly bestBreak: { readonly minutes: number; readonly recoveryRate: number; readonly resolvedBreaks: number } | null;
};
