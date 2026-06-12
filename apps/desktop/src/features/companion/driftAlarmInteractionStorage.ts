import { DRIFT_ALARM_INTERACTION_STORAGE_KEY, INTERACTION_LOG_LIMIT } from "./driftAlarmRecoveryTypes";
import type { BreakRecoveryOutcome, DriftAlarmActionName, DriftAlarmBreakOutcomeInteraction, DriftAlarmInteraction } from "./driftAlarmRecoveryTypes";
import type { DriftAlarmEvent } from "./DriftAlarm";

export function recordDriftAlarmInteraction(entry: DriftAlarmInteraction, storage = browserStorage()): DriftAlarmInteraction[] {
  if (!storage) return [];
  const existing = readDriftAlarmInteractions(storage);
  const next = dedupeBreakOutcome([...existing, entry]).slice(-INTERACTION_LOG_LIMIT);
  try {
    storage.setItem(DRIFT_ALARM_INTERACTION_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    reportStorageFailure("write", error);
  }
  return next;
}

export function readDriftAlarmInteractions(storage = browserStorage()): DriftAlarmInteraction[] {
  if (!storage) return [];
  try {
    const rawValue = storage.getItem(DRIFT_ALARM_INTERACTION_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDriftAlarmInteraction).slice(-INTERACTION_LOG_LIMIT);
  } catch (error) {
    reportStorageFailure("read", error);
    return [];
  }
}

function dedupeBreakOutcome(interactions: readonly DriftAlarmInteraction[]): DriftAlarmInteraction[] {
  const outcomeByAttempt = new Map<string, DriftAlarmBreakOutcomeInteraction>();
  const otherInteractions: DriftAlarmInteraction[] = [];
  for (const interaction of interactions) {
    if (interaction.kind === "break_outcome") {
      outcomeByAttempt.set(interaction.attemptId, interaction);
    } else {
      otherInteractions.push(interaction);
    }
  }
  return [...otherInteractions, ...outcomeByAttempt.values()].sort((left, right) => interactionTimestamp(left) - interactionTimestamp(right));
}

export function interactionTimestamp(interaction: DriftAlarmInteraction): number {
  if (interaction.kind === "shown") return new Date(interaction.shownAt).getTime();
  if (interaction.kind === "action") return new Date(interaction.actedAt).getTime();
  return new Date(interaction.resolvedAt).getTime();
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function reportStorageFailure(operation: "read" | "write", error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to ${operation} drift alarm interaction log`, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDriftAlarmInteraction(value: unknown): value is DriftAlarmInteraction {
  if (!isRecord(value)) return false;
  if (value.kind === "shown") {
    return typeof value.alarmId === "string" && isAlarmMode(value.mode) && typeof value.shownAt === "string" && typeof value.driftDurationSeconds === "number";
  }
  if (value.kind === "action") {
    return typeof value.alarmId === "string" && isAlarmMode(value.mode) && isActionName(value.action) && typeof value.actedAt === "string";
  }
  return value.kind === "break_outcome"
    && typeof value.alarmId === "string"
    && typeof value.attemptId === "string"
    && typeof value.minutes === "number"
    && isBreakRecoveryOutcome(value.outcome)
    && typeof value.sourceLabel === "string"
    && typeof value.resolvedAt === "string";
}

function isAlarmMode(value: unknown): value is DriftAlarmEvent["mode"] {
  return value === "drift" || value === "break_return";
}

function isActionName(value: unknown): value is DriftAlarmActionName {
  return value === "return_to_focus" || value === "start_break" || value === "manual_correction" || value === "settings" || value === "dismiss";
}

function isBreakRecoveryOutcome(value: unknown): value is BreakRecoveryOutcome {
  return value === "recovered" || value === "same_drift_continued" || value === "drift_shifted" || value === "unknown";
}
