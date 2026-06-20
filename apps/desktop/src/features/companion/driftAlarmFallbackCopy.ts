import { buildDefaultDriftAlarmCopy, buildDriftAlarmCopy, type DriftAlarmRenderedCopy } from "./driftAlarmCopy";
import type { DriftAlarmEvent, DriftAlarmFocusTarget } from "./driftAlarmEvent";

export function buildFallbackDriftAlarmCopy(event: DriftAlarmEvent, focusTargets: readonly DriftAlarmFocusTarget[]): DriftAlarmRenderedCopy {
  const defaultCopy = buildDefaultDriftAlarmCopy();
  switch (event.mode) {
    case "drift":
      return buildDriftAlarmCopy(defaultCopy, {
        mode: "drift",
        contextLabel: event.contextLabel,
        driftDurationLabel: event.driftDurationLabel,
        latestFocusLabel: focusTargets[0]?.label ?? null,
      });
    case "break_return":
      return buildDriftAlarmCopy(defaultCopy, {
        mode: "break_return",
        breakDurationLabel: event.breakReturn.breakDurationLabel,
        pausedFromLabel: event.breakReturn.pausedFromLabel,
        nextFocusLabel: event.breakReturn.nextFocusLabel,
      });
    default:
      return assertNeverDriftAlarmEvent(event);
  }
}

function assertNeverDriftAlarmEvent(value: never): never {
  throw new Error(`Unexpected drift alarm event: ${JSON.stringify(value)}`);
}
