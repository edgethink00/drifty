import type { DisplayLanguage } from "../localization/languagePreference";
import { translateFor } from "../localization/translate";
import { petNameAsSubject } from "../pet-mode/petName";

export type DriftAlarmCopySettingsValue = {
  readonly driftTitle: string;
  readonly driftSummary: string;
  readonly petInterceptTitle: string;
  readonly petInterceptSummary: string;
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

export type DriftAlarmCopyField = keyof DriftAlarmCopySettingsValue;

export const DRIFT_ALARM_COPY_FIELDS: readonly DriftAlarmCopyField[] = [
  "driftTitle",
  "driftSummary",
  "petInterceptTitle",
  "petInterceptSummary",
  "currentContextPill",
  "latestFocusPill",
  "returnToFocusLabel",
  "takeBreakLabel",
  "noFocusTargetLabel",
  "backToDashboardLabel",
  "manualCorrectionLabel",
  "breakReturnTitle",
  "breakReturnSummary",
  "pausedFromPill",
  "nextFocusPill",
  "extendBreakLabel",
  "notificationTitle",
  "notificationBody",
  "extremeNudgeTitle",
];

export type DriftAlarmCopyContext =
  | {
    readonly mode: "drift";
    readonly contextLabel: string;
    readonly driftDurationLabel: string;
    readonly latestFocusLabel: string | null;
  }
  | {
    readonly mode: "pet_intercept";
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
  /** The named desktop cat that pressed the X itself, when it did; null when the close ran without its paw. */
  readonly closedByPet?: { readonly name: string; readonly language: DisplayLanguage } | null;
};

export type ExtremeNudgeToastCopy = {
  readonly title: string;
};

type TemplateValues = Record<string, string | null>;

/**
 * Default wording follows the display language. The tables live in
 * translations.ts under companion.copy.*; the pet-intercept title is kept
 * distinct from the ordinary drift headline on purpose: catching the cat is a
 * deliberate physical act, so the card has to show it landed. (The English
 * default is "Still drifting?" and the case is "pet_intercept".)
 */
export function buildDefaultDriftAlarmCopy(language: DisplayLanguage = "en"): DriftAlarmCopySettingsValue {
  const t = translateFor(language);
  return {
    driftTitle: t("companion.copy.driftTitle"),
    driftSummary: t("companion.copy.driftSummary"),
    petInterceptTitle: t("companion.copy.petInterceptTitle"),
    petInterceptSummary: t("companion.copy.petInterceptSummary"),
    currentContextPill: t("companion.copy.currentContextPill"),
    latestFocusPill: t("companion.copy.latestFocusPill"),
    returnToFocusLabel: t("companion.copy.returnToFocusLabel"),
    takeBreakLabel: t("companion.copy.takeBreakLabel"),
    noFocusTargetLabel: t("companion.copy.noFocusTargetLabel"),
    backToDashboardLabel: t("companion.copy.backToDashboardLabel"),
    manualCorrectionLabel: t("companion.copy.manualCorrectionLabel"),
    breakReturnTitle: t("companion.copy.breakReturnTitle"),
    breakReturnSummary: t("companion.copy.breakReturnSummary"),
    pausedFromPill: t("companion.copy.pausedFromPill"),
    nextFocusPill: t("companion.copy.nextFocusPill"),
    extendBreakLabel: t("companion.copy.extendBreakLabel"),
    notificationTitle: t("companion.copy.notificationTitle"),
    notificationBody: t("companion.copy.notificationBody"),
    extremeNudgeTitle: t("companion.copy.extremeNudgeTitle"),
  };
}

/**
 * Every field renders from the resolved settings. A resolved value is never
 * blank (storage drops blank overrides), so the English default here is only
 * a last-resort guard for callers that hand in a partial object.
 */
export function buildDriftAlarmCopy(settings: DriftAlarmCopySettingsValue, context: DriftAlarmCopyContext): DriftAlarmRenderedCopy {
  const defaults = buildDefaultDriftAlarmCopy();
  const sharedCopy = {
    returnToFocusLabel: fallbackText(settings.returnToFocusLabel, defaults.returnToFocusLabel),
    noFocusTargetLabel: fallbackText(settings.noFocusTargetLabel, defaults.noFocusTargetLabel),
    backToDashboardLabel: fallbackText(settings.backToDashboardLabel, defaults.backToDashboardLabel),
    manualCorrectionLabel: fallbackText(settings.manualCorrectionLabel, defaults.manualCorrectionLabel),
  };

  switch (context.mode) {
    case "drift":
    case "pet_intercept": {
      const intercepted = context.mode === "pet_intercept";
      const values = {
        context: fallbackText(context.contextLabel, "This drift"),
        driftDuration: context.driftDurationLabel,
        latestFocus: context.latestFocusLabel,
      } satisfies TemplateValues;
      const latestFocusPill = context.latestFocusLabel
        ? [renderTemplate(settings.latestFocusPill, defaults.latestFocusPill, values)]
        : [];

      return {
        ...sharedCopy,
        title: intercepted
          ? renderTemplate(settings.petInterceptTitle, defaults.petInterceptTitle, values)
          : renderTemplate(settings.driftTitle, defaults.driftTitle, values),
        summary: intercepted
          ? renderTemplate(settings.petInterceptSummary, defaults.petInterceptSummary, values)
          : renderTemplate(settings.driftSummary, defaults.driftSummary, values),
        contextPills: [
          renderTemplate(settings.currentContextPill, defaults.currentContextPill, values),
          ...latestFocusPill,
        ],
        breakChoiceLabel: fallbackText(settings.takeBreakLabel, defaults.takeBreakLabel),
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
        summary: renderTemplate(settings.breakReturnSummary, defaults.breakReturnSummary, values),
        contextPills: [
          renderTemplate(settings.pausedFromPill, defaults.pausedFromPill, values),
          renderTemplate(settings.nextFocusPill, defaults.nextFocusPill, values),
        ],
        breakChoiceLabel: fallbackText(settings.extendBreakLabel, defaults.extendBreakLabel),
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
    body: renderTemplate(settings.notificationBody, defaults.notificationBody, values),
  };
}

export function buildExtremeNudgeToastCopy(settings: DriftAlarmCopySettingsValue, context: ExtremeNudgeToastCopyContext): ExtremeNudgeToastCopy {
  const defaults = buildDefaultDriftAlarmCopy();
  const pet = context.closedByPet;
  // The cat's name only replaces the default wording. A title the user wrote stays theirs.
  if (pet && pet.name.trim() && settings.extremeNudgeTitle.trim() === buildDefaultDriftAlarmCopy(pet.language).extremeNudgeTitle) {
    return {
      title: translateFor(pet.language)("petName.toastTitle", {
        petSubject: petNameAsSubject(pet.name.trim(), pet.language),
        closed: context.closedLabel.trim(),
      }),
    };
  }
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
