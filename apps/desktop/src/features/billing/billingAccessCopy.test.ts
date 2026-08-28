import { describe, expect, it } from "vitest";
import { formatBillingAccessEndDate } from "./billingAccessCopy";

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
