import type { TranslationKey } from "../localization/translations";

export const DEV_SETTINGS_SUBSECTION_STORAGE_KEY = "drifty.dev.settingsSubsection";

export const DEV_SETTINGS_SUBSECTIONS = [
  {
    id: "diagnostics",
    labelKey: "settings.dev.subsection.diagnostics",
  },
  {
    id: "featureFlags",
    labelKey: "settings.dev.subsection.featureFlags",
  },
  {
    id: "petCompanion",
    labelKey: "settings.dev.subsection.petCompanion",
  },
  {
    id: "aiCapture",
    labelKey: "settings.dev.subsection.aiCapture",
  },
  {
    id: "uiFlows",
    labelKey: "settings.dev.subsection.uiFlows",
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly labelKey: TranslationKey;
}>;

export type DevSettingsSubsection = (typeof DEV_SETTINGS_SUBSECTIONS)[number]["id"];

export function resolveDevSettingsSubsection(value: string | null): DevSettingsSubsection {
  return DEV_SETTINGS_SUBSECTIONS.some((option) => option.id === value)
    ? value as DevSettingsSubsection
    : "diagnostics";
}
