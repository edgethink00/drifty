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
      title: "팀 플랜",
      summary: `${name} 팀 플랜에서 Pro를 받고 있어서 따로 결제할 필요가 없어요.`,
    }
    : {
      title: "Team plan",
      summary: `Your Pro comes from the ${name} team plan, so there is nothing for you to pay.`,
    });
}
