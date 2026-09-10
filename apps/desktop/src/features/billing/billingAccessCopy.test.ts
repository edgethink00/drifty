import { describe, expect, it } from "vitest";
import { formatBillingAccessEndDate, formatOrganizationSeatAccessCopy } from "./billingAccessCopy";

describe("formatBillingAccessEndDate", () => {
  it("formats an exact promotion end date for each supported language", () => {
    expect(formatBillingAccessEndDate("2026-10-26T00:00:00.000Z", "en")).toMatch(/Oct 26, 2026/);
    expect(formatBillingAccessEndDate("2026-10-26T00:00:00.000Z", "ko")).toMatch(/2026년 10월 26일/);
  });

  it("does not invent a date for missing or invalid input", () => {
    expect(formatBillingAccessEndDate(null, "en")).toBeNull();
    expect(formatBillingAccessEndDate("not-a-date", "ko")).toBeNull();
  });
});

describe("formatOrganizationSeatAccessCopy", () => {
  it("names the organization and says access comes from its seat, not a personal subscription", () => {
    expect(formatOrganizationSeatAccessCopy("Acme", "en")).toEqual({
      title: "Organization seat",
      summary: "Your app access comes from an organization seat at Acme, not a personal subscription.",
    });
    expect(formatOrganizationSeatAccessCopy("Acme", "ko")).toEqual({
      title: "조직 좌석",
      summary: "개인 구독이 아니라 Acme 조직 좌석으로 앱을 사용하고 있어요.",
    });
  });

  it("does not call the access Pro or invent a plan name", () => {
    const english = formatOrganizationSeatAccessCopy("Acme", "en");
    const korean = formatOrganizationSeatAccessCopy("Acme", "ko");
    const combined = `${english?.title} ${english?.summary} ${korean?.title} ${korean?.summary}`;
    expect(combined).not.toMatch(/Pro|Enterprise|엔터프라이즈/i);
  });

  it("does not invent copy for a missing organization name", () => {
    expect(formatOrganizationSeatAccessCopy("   ", "en")).toBeNull();
    expect(formatOrganizationSeatAccessCopy("", "ko")).toBeNull();
  });
});
