import type { DisplayLanguage, LocalizationController } from "./LocalizationContext";

export function localizeSettingsError(
  value: string,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  return language === "en" ? value : t("settings.error.actionFailed", { detail: value });
}

export function localizeUpdateMessage(
  value: string,
  kind: "status" | "error",
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  if (language === "en") return value;
  if (value === "Checking for updates...") return t("settings.general.checking");
  if (value === "Drifty is up to date.") return t("settings.general.upToDate");

  const availableMatch = /^Drifty (.+) is available\.$/u.exec(value);
  if (availableMatch) return t("settings.general.updateAvailable", { version: availableMatch[1] });

  const checkFailureMatch = /^Update check failed: (.+)$/u.exec(value);
  if (checkFailureMatch) return t("settings.general.updateCheckFailed", { detail: checkFailureMatch[1] });

  const installFailureMatch = /^Update install failed: (.+)$/u.exec(value);
  if (installFailureMatch) return t("settings.general.updateInstallFailed", { detail: installFailureMatch[1] });

  return t(
    kind === "error" ? "settings.general.updateErrorDetail" : "settings.general.updateStatusDetail",
    { detail: value },
  );
}
