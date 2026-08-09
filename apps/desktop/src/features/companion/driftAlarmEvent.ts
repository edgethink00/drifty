import { buildDefaultDriftAlarmCopy, buildDriftAlarmCopy, type DriftAlarmCopySettingsValue, type DriftAlarmRenderedCopy } from "./driftAlarmCopy";

export type DriftAlarmAction =
  | { readonly type: "return_to_focus"; readonly targetId: string }
  | { readonly type: "start_break"; readonly minutes: number }
  | { readonly type: "manual_correction" }
  | { readonly type: "settings" };

export type DriftAlarmFocusTarget = {
  readonly targetId: string;
  readonly label: string;
  readonly detail: string;
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName?: string | null;
  readonly siteDomain: string | null;
  readonly siteTitle: string | null;
  readonly siteUrl?: string | null;
  readonly iconSrc: string | null;
};

export type DriftAlarmBreakReturnDetails = {
  readonly breakDurationMinutes: number;
  readonly breakDurationLabel: string;
  readonly pausedFromLabel: string;
  readonly nextFocusLabel: string;
};

type DriftAlarmEventBase = {
  readonly id: string;
  readonly contextLabel: string;
  readonly driftDurationLabel: string;
  readonly driftDurationSeconds: number;
  readonly preservedFocusStrikeLabel: string;
  readonly preservedFocusStrikeSeconds: number;
  readonly generatedAt: string;
  readonly breakOptions: readonly number[];
  readonly focusTargets: readonly DriftAlarmFocusTarget[];
  readonly sourceSiteDomain: string | null;
  readonly sourceAppName: string;
  readonly sourceIconSrc: string | null;
  readonly copy?: DriftAlarmRenderedCopy;
  readonly sourceSegmentId?: string | null;
};

export type DriftAlarmEvent = DriftAlarmEventBase & (
  | { readonly mode: "drift"; readonly breakReturn: null }
  | { readonly mode: "break_return"; readonly breakReturn: DriftAlarmBreakReturnDetails }
);

type DriftAlarmEventInput = {
  readonly id: string;
  readonly contextLabel: string;
  readonly driftDurationSeconds: number;
  readonly preservedFocusStrikeSeconds: number;
  readonly generatedAt: string;
  readonly breakOptions?: readonly number[];
  readonly focusTargets?: readonly DriftAlarmFocusTarget[];
  readonly sourceSiteDomain?: string | null;
  readonly sourceAppName?: string;
  readonly sourceIconSrc?: string | null;
  readonly copySettings?: DriftAlarmCopySettingsValue;
  /* Copy-only switch. The event still carries mode "drift" so every consumer,
     surface size, and stored interaction keeps working unchanged. */
  readonly petIntercepted?: boolean;
  readonly sourceSegmentId?: string | null;
};

type BreakReturnAlarmEventInput = DriftAlarmEventInput & {
  readonly breakDurationMinutes: number;
  readonly pausedFromLabel: string;
  readonly nextFocusLabel: string;
};

const DRIFT_ALARM_BREAK_OPTIONS = [5, 15, 30, 60] as const;
export const DRIFT_ALARM_FOCUS_TARGET_LIMIT = 4;

export function buildDriftAlarmEvent(input: DriftAlarmEventInput): DriftAlarmEvent {
  const driftDurationLabel = formatDuration(input.driftDurationSeconds);
  const focusTargets = normalizeFocusTargets(input.focusTargets);
  return {
    ...input,
    mode: "drift",
    breakReturn: null,
    driftDurationLabel,
    preservedFocusStrikeLabel: formatFocusStrike(input.preservedFocusStrikeSeconds),
    breakOptions: normalizeBreakOptions(input.breakOptions),
    focusTargets,
    sourceSiteDomain: input.sourceSiteDomain?.trim() ?? null,
    sourceAppName: input.sourceAppName?.trim() || "Unknown app",
    sourceIconSrc: input.sourceIconSrc?.trim() ?? null,
    copy: buildDriftAlarmCopy(input.copySettings ?? buildDefaultDriftAlarmCopy(), {
      mode: input.petIntercepted ? "pet_intercept" : "drift",
      contextLabel: input.contextLabel,
      driftDurationLabel,
      latestFocusLabel: focusTargets[0]?.label ?? null,
    }),
  };
}

export function buildBreakReturnAlarmEvent(input: BreakReturnAlarmEventInput): DriftAlarmEvent {
  const { breakDurationMinutes, pausedFromLabel, nextFocusLabel, ...eventInput } = input;
  const breakOptions = normalizeBreakOptions(input.breakOptions);
  const focusTargets = normalizeFocusTargets(input.focusTargets);
  const driftDurationLabel = formatDuration(input.driftDurationSeconds);
  const breakReturn = {
    breakDurationMinutes,
    breakDurationLabel: formatBreakOption(breakDurationMinutes),
    pausedFromLabel: pausedFromLabel.trim() || "This drift",
    nextFocusLabel: nextFocusLabel.trim() || focusTargets[0]?.label || "your focus",
  };
  return {
    ...eventInput,
    mode: "break_return",
    breakReturn,
    driftDurationLabel,
    preservedFocusStrikeLabel: formatFocusStrike(input.preservedFocusStrikeSeconds),
    breakOptions,
    focusTargets,
    sourceSiteDomain: input.sourceSiteDomain?.trim() ?? null,
    sourceAppName: input.sourceAppName?.trim() || "Unknown app",
    sourceIconSrc: input.sourceIconSrc?.trim() ?? null,
    copy: buildDriftAlarmCopy(input.copySettings ?? buildDefaultDriftAlarmCopy(), {
      mode: "break_return",
      breakDurationLabel: breakReturn.breakDurationLabel,
      pausedFromLabel: breakReturn.pausedFromLabel,
      nextFocusLabel: breakReturn.nextFocusLabel,
    }),
  };
}

export function formatBreakOption(minutes: number): string {
  if (minutes === 60) return "1h";
  return `${minutes}m`;
}

function normalizeBreakOptions(options: readonly number[] | undefined): readonly number[] {
  const source = options && options.length > 0 ? options : DRIFT_ALARM_BREAK_OPTIONS;
  const normalized = Array.from(new Set(source
    .filter((minutes) => Number.isInteger(minutes) && minutes > 0)
    .map((minutes) => Math.min(minutes, 60))))
    .sort((left, right) => left - right);
  return normalized.length > 0 ? normalized : DRIFT_ALARM_BREAK_OPTIONS;
}

function normalizeFocusTargets(targets: readonly DriftAlarmFocusTarget[] | undefined): readonly DriftAlarmFocusTarget[] {
  if (!targets) return [];
  return targets
    .filter((target) => target.targetId.trim().length > 0 && target.label.trim().length > 0)
    .slice(0, DRIFT_ALARM_FOCUS_TARGET_LIMIT);
}

function formatFocusStrike(seconds: number): string {
  if (seconds < 60) return `${seconds}-second`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}-minute`;
  if (minutes === 60) return "1-hour";
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute";
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}
