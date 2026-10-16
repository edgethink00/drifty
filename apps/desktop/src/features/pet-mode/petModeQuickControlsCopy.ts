import type { DisplayLanguage } from "../localization/languagePreference";
import { type TranslationKey } from "../localization/translations";
import { translateFor } from "../localization/translate";
import type { PetQuickControlsAutomaticCloseOverridePayload } from "./petModeBridge";

export type PetQuickControlsCopyParams = Readonly<Record<string, string | number>>;

export function copyFor(
  language: DisplayLanguage,
  key: TranslationKey,
  params?: PetQuickControlsCopyParams,
): string {
  const template = translateFor(language)(key);
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/gu, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function formatAutomaticCloseResumeTime(
  endsAtMs: number,
  language: DisplayLanguage,
): string {
  const date = new Date(endsAtMs);
  const hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const hour12 = hour % 12 || 12;
  if (language === "ko") return `${hour12}:${minute}`;
  if (language === "es") return `${String(hour).padStart(2, "0")}:${minute}`;
  return `${hour12}:${minute}${hour < 12 ? "am" : "pm"}`;
}

export function automaticClosePausedStateLabel(
  language: DisplayLanguage,
  override: PetQuickControlsAutomaticCloseOverridePayload | null,
): string {
  if (!override || override.enabled) return copyFor(language, "pet.quickControls.automaticClosePaused");
  if (override.endsAtMs === null) {
    return copyFor(language, "pet.quickControls.automaticClosePausedUntilResumed");
  }
  return copyFor(language, "pet.quickControls.automaticClosePausedUntil", {
    time: formatAutomaticCloseResumeTime(override.endsAtMs, language),
  });
}

export function automaticClosePausedConfirmationLabel(
  language: DisplayLanguage,
  override: PetQuickControlsAutomaticCloseOverridePayload | null,
): string {
  if (!override || override.enabled) return copyFor(language, "pet.quickControls.automaticClosePaused");
  if (override.endsAtMs === null) {
    return copyFor(language, "pet.quickControls.automaticClosePausedConfirmedForever");
  }
  return copyFor(language, "pet.quickControls.automaticClosePausedConfirmed", {
    time: formatAutomaticCloseResumeTime(override.endsAtMs, language),
  });
}

export function isAutomaticClosePauseAction(action: string): boolean {
  return action === "automaticClosePause15"
    || action === "automaticClosePause60"
    || action === "automaticClosePauseToday"
    || action === "automaticClosePauseForever";
}
