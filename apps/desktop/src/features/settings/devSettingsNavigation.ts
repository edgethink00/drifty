import type { TranslationKey } from "../localization/translations";

export const DEV_SETTINGS_SUBSECTION_STORAGE_KEY = "drifty.dev.settingsSubsection";

export const DEV_SETTINGS_SUBSECTIONS = [
  {
    id: "diagnostics",
    labelKey: "settings.dev.subsection.diagnostics",
  },
  {
    id: "flags",
    labelKey: "settings.dev.subsection.flags",
  },
  {
    id: "previews",
    labelKey: "settings.dev.subsection.previews",
  },
  {
    id: "lab",
    labelKey: "settings.dev.subsection.lab",
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly labelKey: TranslationKey;
}>;

export type DevSettingsSubsection = (typeof DEV_SETTINGS_SUBSECTIONS)[number]["id"];

export function resolveDevSettingsSubsection(value: string | null): DevSettingsSubsection {
  const legacySubsections: Readonly<Record<string, DevSettingsSubsection>> = {
    featureFlags: "flags",
    uiFlows: "previews",
    petCompanion: "lab",
    aiCapture: "diagnostics",
  };
  if (value && legacySubsections[value]) return legacySubsections[value];
  return DEV_SETTINGS_SUBSECTIONS.some((option) => option.id === value)
    ? value as DevSettingsSubsection
    : "diagnostics";
}

export function resolveDevSettingsReviewSubsection(
  search: string,
  enabled = import.meta.env.DEV,
): DevSettingsSubsection | null {
  if (!enabled) return null;
  const query = new URLSearchParams(search);
  if (query.get("review") !== "dev-settings") return null;
  return resolveDevSettingsSubsection(query.get("subsection"));
}

/** Development-only direct entry to Settings › Agents & CLI (`?review=agents-cli`). */
export function isAgentsSettingsReviewLink(
  search: string,
  enabled = import.meta.env.DEV,
): boolean {
  return enabled && new URLSearchParams(search).get("review") === "agents-cli";
}
