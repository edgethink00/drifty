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

export type OrganizationSeatAccessCopy = {
  readonly title: string;
  readonly summary: string;
};

export function formatOrganizationSeatAccessCopy(
  organizationName: string,
  language: DisplayLanguage,
): OrganizationSeatAccessCopy | null {
  const name = organizationName.trim();
  if (!name) return null;

  return Object.freeze(language === "ko"
    ? {
      title: "조직 좌석",
      summary: `개인 구독이 아니라 ${name} 조직 좌석으로 앱을 사용하고 있어요.`,
    }
    : {
      title: "Organization seat",
      summary: `Your app access comes from an organization seat at ${name}, not a personal subscription.`,
    });
}
