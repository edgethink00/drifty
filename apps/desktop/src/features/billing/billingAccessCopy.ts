import type { DisplayLanguage } from "../localization/LocalizationContext";

export function formatBillingAccessEndDate(value: string | null, language: DisplayLanguage): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: language === "ko" ? "long" : "short",
    day: "numeric",
  }).format(date);
}
