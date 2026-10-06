import type { LocalizationController } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { CloudAiQuotaWindow } from "./cloudAiRequestBackoff";

/** Safe server/backoff metadata for user-facing recovery, with no account data. */
export type CloudQuotaRecovery = {
  readonly window: CloudAiQuotaWindow | null;
  readonly retryAtMs: number | null;
};

export function cloudQuotaTitleKey(window?: CloudAiQuotaWindow | null): TranslationKey {
  switch (window) {
    case "minute": return "ai.quota.minute";
    case "hour": return "ai.quota.hour";
    case "day": return "ai.quota.day";
    default: return "ai.quota.unknown";
  }
}

export function cloudQuotaResumeMessage(
  quota: CloudQuotaRecovery | undefined,
  canUpgradeTrial: boolean,
  { t, effectiveLanguage }: Pick<LocalizationController, "t" | "effectiveLanguage">,
): string {
  const retryAt = quota?.retryAtMs;
  const resume = typeof retryAt === "number" && Number.isFinite(new Date(retryAt).getTime())
    ? t("ai.quota.retryAt", { time: new Intl.DateTimeFormat(effectiveLanguage === "ko" ? "ko-KR" : "en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(retryAt)) })
    : t("ai.quota.retryLater");
  return [resume, canUpgradeTrial ? t("ai.quota.trialUpgrade") : ""].filter(Boolean).join(" ");
}

export function cloudQuotaRecoveryMessage(
  quota: CloudQuotaRecovery | undefined,
  canUpgradeTrial: boolean,
  localization: Pick<LocalizationController, "t" | "effectiveLanguage">,
): string {
  return localization.t(cloudQuotaTitleKey(quota?.window)) + ". "
    + cloudQuotaResumeMessage(quota, canUpgradeTrial, localization);
}
