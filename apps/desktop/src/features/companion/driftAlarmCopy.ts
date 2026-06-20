export type DriftAlarmCopySettingsValue = {
  readonly driftTitle: string;
  readonly driftSummary: string;
  readonly currentContextPill: string;
  readonly latestFocusPill: string;
  readonly returnToFocusLabel: string;
  readonly takeBreakLabel: string;
  readonly noFocusTargetLabel: string;
  readonly backToDashboardLabel: string;
  readonly manualCorrectionLabel: string;
  readonly breakReturnTitle: string;
  readonly breakReturnSummary: string;
  readonly pausedFromPill: string;
  readonly nextFocusPill: string;
  readonly extendBreakLabel: string;
  readonly notificationTitle: string;
  readonly notificationBody: string;
  readonly extremeNudgeTitle: string;
};

export type DriftAlarmCopyContext =
  | {
    readonly mode: "drift";
    readonly contextLabel: string;
    readonly driftDurationLabel: string;
    readonly latestFocusLabel: string | null;
  }
  | {
    readonly mode: "break_return";
    readonly breakDurationLabel: string;
    readonly pausedFromLabel: string;
    readonly nextFocusLabel: string;
  };

export type DriftAlarmRenderedCopy = {
  readonly title: string;
  readonly summary: string;
  readonly contextPills: readonly string[];
  readonly returnToFocusLabel: string;
  readonly breakChoiceLabel: string;
  readonly noFocusTargetLabel: string;
  readonly backToDashboardLabel: string;
  readonly manualCorrectionLabel: string;
};

export type DriftNotificationCopyContext = {
  readonly driftDurationLabel: string;
  readonly place: string;
};

export type DriftNotificationCopy = {
  readonly title: string;
  readonly body: string;
};

export type ExtremeNudgeToastCopyContext = {
  readonly closedLabel: string;
};

export type ExtremeNudgeToastCopy = {
  readonly title: string;
};

type TemplateValues = Record<string, string | null>;

const DEFAULT_DRIFT_ALARM_COPY = {
  driftTitle: "Let's get you back in flow.",
  driftSummary: "This seems outside your focus flow.",
  currentContextPill: "Now {context}",
  latestFocusPill: "Latest focus {latestFocus}",
  returnToFocusLabel: "Return to focus",
  takeBreakLabel: "Take a break",
  noFocusTargetLabel: "No recent focus destination yet.",
  backToDashboardLabel: "Back to dashboard",
  manualCorrectionLabel: "Not a drift",
  breakReturnTitle: "{breakDuration} Break finished",
  breakReturnSummary: "Break · {breakDuration} complete",
  pausedFromPill: "Paused from {pausedFrom}",
  nextFocusPill: "Next focus {nextFocus}",
  extendBreakLabel: "Extend break",
  notificationTitle: "Drift detected",
  notificationBody: "{driftDuration} on {place}. Take a breath and choose the next action.",
  extremeNudgeTitle: "Closed {closed}",
} as const satisfies DriftAlarmCopySettingsValue;

export function buildDefaultDriftAlarmCopy(): DriftAlarmCopySettingsValue {
  return { ...DEFAULT_DRIFT_ALARM_COPY };
}

export function buildDriftAlarmCopy(settings: DriftAlarmCopySettingsValue, context: DriftAlarmCopyContext): DriftAlarmRenderedCopy {
  const defaults = buildDefaultDriftAlarmCopy();
  const sharedCopy = {
    returnToFocusLabel: defaults.returnToFocusLabel,
    noFocusTargetLabel: defaults.noFocusTargetLabel,
    backToDashboardLabel: defaults.backToDashboardLabel,
    manualCorrectionLabel: defaults.manualCorrectionLabel,
  };

  switch (context.mode) {
    case "drift": {
      const values = {
        context: fallbackText(context.contextLabel, "This drift"),
        driftDuration: context.driftDurationLabel,
        latestFocus: context.latestFocusLabel,
      } satisfies TemplateValues;
      const latestFocusPill = context.latestFocusLabel
        ? [renderTemplate(defaults.latestFocusPill, defaults.latestFocusPill, values)]
        : [];

      return {
        ...sharedCopy,
        title: renderTemplate(settings.driftTitle, defaults.driftTitle, values),
        summary: renderTemplate(defaults.driftSummary, defaults.driftSummary, values),
        contextPills: [
          renderTemplate(defaults.currentContextPill, defaults.currentContextPill, values),
          ...latestFocusPill,
        ],
        breakChoiceLabel: defaults.takeBreakLabel,
      };
    }
    case "break_return": {
      const values = {
        breakDuration: context.breakDurationLabel,
        pausedFrom: context.pausedFromLabel,
        nextFocus: context.nextFocusLabel,
      } satisfies TemplateValues;

      return {
        ...sharedCopy,
        title: renderTemplate(settings.breakReturnTitle, defaults.breakReturnTitle, values),
        summary: renderTemplate(defaults.breakReturnSummary, defaults.breakReturnSummary, values),
        contextPills: [
          renderTemplate(defaults.pausedFromPill, defaults.pausedFromPill, values),
          renderTemplate(defaults.nextFocusPill, defaults.nextFocusPill, values),
        ],
        breakChoiceLabel: defaults.extendBreakLabel,
      };
    }
    default:
      return assertNever(context);
  }
}

export function buildDriftNotificationCopy(settings: DriftAlarmCopySettingsValue, context: DriftNotificationCopyContext): DriftNotificationCopy {
  const defaults = buildDefaultDriftAlarmCopy();
  const values = {
    driftDuration: context.driftDurationLabel,
    place: context.place,
  } satisfies TemplateValues;

  return {
    title: renderTemplate(settings.notificationTitle, defaults.notificationTitle, values),
    body: renderTemplate(defaults.notificationBody, defaults.notificationBody, values),
  };
}

export function buildExtremeNudgeToastCopy(settings: DriftAlarmCopySettingsValue, context: ExtremeNudgeToastCopyContext): ExtremeNudgeToastCopy {
  const defaults = buildDefaultDriftAlarmCopy();
  const values = {
    closed: context.closedLabel,
  } satisfies TemplateValues;

  return {
    title: renderTemplate(settings.extremeNudgeTitle, defaults.extremeNudgeTitle, values),
  };
}

function renderTemplate(template: string, fallback: string, values: TemplateValues): string {
  return fallbackText(template, fallback).replace(/\{([a-zA-Z]+)\}/g, (_match, token: string) => {
    const value = values[token] ?? "";
    return value.trim();
  }).replace(/\s+/g, " ").trim();
}

function fallbackText(value: string | null, fallback: string): string {
  const normalizedValue = value?.trim() ?? "";
  return normalizedValue.length > 0 ? normalizedValue : fallback;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected drift alarm copy context: ${JSON.stringify(value)}`);
}
