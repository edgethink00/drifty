import { describe, expect, it } from "vitest";

import { addInviteRecipients, isValidInviteEmail, parseInviteRecipients, planAfterEmailInviteSend } from "./teamEmailInviteModel";

describe("team email invite input (2026-10-29)", () => {
  it("reads recipients copied from a mail app, in order, keeping the bracketed address", () => {
    expect(parseInviteRecipients("Hana Kim <hana@company.com>, minji@company.com; bad\nJun Park <jun@company.com>")).toEqual([
      "hana@company.com",
      "minji@company.com",
      "bad",
      "jun@company.com",
    ]);
    expect(parseInviteRecipients("minji@company.com Hana Kim <hana@company.com>")).toEqual(["minji@company.com", "hana@company.com"]);
  });

  it("adds new addresses after the chips and skips repeats regardless of case", () => {
    expect(addInviteRecipients(["hana@company.com"], "HANA@company.com, minji@company.com")).toEqual(["hana@company.com", "minji@company.com"]);
  });

  it("accepts only addresses the server also accepts", () => {
    expect(isValidInviteEmail("hana@company.com")).toBe(true);
    for (const value of ["hana", "hana@company", "hana@company.c", "a@b@c.com", "x".repeat(312) + "@company.com"]) expect(isValidInviteEmail(value), value).toBe(false);
  });
});

describe("after an email invite send (2026-10-29)", () => {
  it("closes only when everything went out and nothing needs fixing", () => {
    expect(planAfterEmailInviteSend([{ email: "hana@company.com", outcome: "sent" }, { email: "alex@company.com", outcome: "member" }], []).close).toBe(true);
    expect(planAfterEmailInviteSend([{ email: "hana@company.com", outcome: "recent" }], []).close).toBe(true);
    expect(planAfterEmailInviteSend([{ email: "alex@company.com", outcome: "member" }], []).close).toBe(false);
  });

  it("keeps undelivered and invalid addresses in the field, in that order", () => {
    const plan = planAfterEmailInviteSend([
      { email: "hana@company.com", outcome: "sent" },
      { email: "minji@company.com", outcome: "failed" },
      { email: "jun@company.com", outcome: "limited" },
    ], ["bad"]);
    expect(plan.close).toBe(false);
    expect(plan.keep).toEqual(["minji@company.com", "jun@company.com", "bad"]);
    expect(plan.sent).toEqual(["hana@company.com"]);
  });
});
