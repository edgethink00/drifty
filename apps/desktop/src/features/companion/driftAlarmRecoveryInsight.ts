import { interactionTimestamp } from "./driftAlarmInteractionStorage";
import type { BreakRecoveryInsight, DriftAlarmActionName, BreakRecoveryOutcome, DriftAlarmInteraction } from "./driftAlarmRecoveryTypes";

export function buildBreakRecoveryInsight({
  interactions,
  rangeStart,
  rangeEnd,
}: {
  readonly interactions: readonly DriftAlarmInteraction[];
  readonly rangeStart: string;
  readonly rangeEnd: string;
}): BreakRecoveryInsight {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  const actionCounts = zeroActionCounts();
  const outcomeCounts = zeroOutcomeCounts();
  const breakStats = new Map<number, { readonly minutes: number; readonly recovered: number; readonly resolved: number }>();

  for (const interaction of interactions) {
    if (!isWithinRange(interactionTimestamp(interaction), rangeStartMs, rangeEndMs)) continue;
    if (interaction.kind === "action") {
      actionCounts[interaction.action] += 1;
      continue;
    }
    if (interaction.kind !== "break_outcome") continue;
    outcomeCounts[interaction.outcome] += 1;
    if (interaction.outcome === "unknown") continue;
    const current = breakStats.get(interaction.minutes) ?? { minutes: interaction.minutes, recovered: 0, resolved: 0 };
    breakStats.set(interaction.minutes, {
      minutes: interaction.minutes,
      recovered: current.recovered + (interaction.outcome === "recovered" ? 1 : 0),
      resolved: current.resolved + 1,
    });
  }

  const resolvedBreaks = outcomeCounts.recovered + outcomeCounts.same_drift_continued + outcomeCounts.drift_shifted;
  const bestBreak = Array.from(breakStats.values())
    .filter((item) => item.resolved > 0)
    .map((item) => ({ minutes: item.minutes, recoveryRate: item.recovered / item.resolved, resolvedBreaks: item.resolved }))
    .sort((left, right) => right.recoveryRate - left.recoveryRate || right.resolvedBreaks - left.resolvedBreaks || left.minutes - right.minutes)[0] ?? null;

  return {
    actionCounts,
    outcomeCounts,
    recoveryRate: resolvedBreaks > 0 ? outcomeCounts.recovered / resolvedBreaks : null,
    resolvedBreaks,
    totalBreaks: resolvedBreaks + outcomeCounts.unknown,
    bestBreak,
  };
}

function isWithinRange(value: number, start: number, end: number): boolean {
  return Number.isFinite(value) && value >= start && value <= end;
}

function zeroActionCounts(): Record<DriftAlarmActionName, number> {
  return { return_to_focus: 0, start_break: 0, manual_correction: 0, settings: 0, dismiss: 0 };
}

function zeroOutcomeCounts(): Record<BreakRecoveryOutcome, number> {
  return { recovered: 0, same_drift_continued: 0, drift_shifted: 0, unknown: 0 };
}
