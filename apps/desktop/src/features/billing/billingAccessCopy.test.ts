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
  it("names the Team plan and the team the Pro comes from", () => {
    expect(formatOrganizationSeatAccessCopy("Acme", "en")).toEqual({
      title: "Team plan",
      summary: "Your Pro comes from the Acme team plan, so there is nothing for you to pay.",
    });
    expect(formatOrganizationSeatAccessCopy("Acme", "ko")).toEqual({
      title: "팀 플랜",
      summary: "Acme 팀 플랜에서 Pro를 받고 있어서 따로 결제할 필요가 없어요.",
    });
  });

  it("uses the public Team plan name instead of the internal Enterprise one", () => {
    const english = formatOrganizationSeatAccessCopy("Acme", "en");
    const korean = formatOrganizationSeatAccessCopy("Acme", "ko");
    const combined = `${english?.title} ${english?.summary} ${korean?.title} ${korean?.summary}`;
    expect(combined).not.toMatch(/Enterprise|엔터프라이즈|organization seat|조직 좌석/i);
  });

  it("does not invent copy for a missing organization name", () => {
    expect(formatOrganizationSeatAccessCopy("   ", "en")).toBeNull();
    expect(formatOrganizationSeatAccessCopy("", "ko")).toBeNull();
  });
});
