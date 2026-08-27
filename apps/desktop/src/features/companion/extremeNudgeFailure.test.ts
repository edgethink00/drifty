import { describe, expect, it } from "vitest";

import {
  ExtremeNudgeApplyError,
  getExtremeNudgeFailure,
  normalizeExtremeNudgeDiagnostic,
  normalizeExtremeNudgeFailure,
} from "./extremeNudgeFailure";

describe("extreme nudge failure contract", () => {
  it("accepts a stable native failure code and an allowlisted diagnostic", () => {
    expect(normalizeExtremeNudgeFailure({
      code: "browser_tab_not_found",
      diagnostic: "chromium_ax_close_failed",
    })).toEqual({
      code: "browser_tab_not_found",
      diagnostic: "chromium_ax_close_failed",
    });
  });

  it("drops unsafe diagnostics instead of retaining target details", () => {
    expect(normalizeExtremeNudgeFailure({
      code: "automation_failed",
      diagnostic: "failed https://example.com/private?token=secret",
    })).toEqual({
      code: "automation_failed",
      diagnostic: null,
    });
  });

  it("allowlists success diagnostics with the same bounded contract", () => {
    expect(normalizeExtremeNudgeDiagnostic(" chromium_ax_front_tab ")).toBe("chromium_ax_front_tab");
    expect(normalizeExtremeNudgeDiagnostic("closed:https://example.com/private")).toBeNull();
    expect(normalizeExtremeNudgeDiagnostic("x".repeat(97))).toBeNull();
  });

  it("classifies a legacy browser error without carrying its URL forward", () => {
    const failure = normalizeExtremeNudgeFailure(
      "Browser tab was not found for https://example.com/private?token=secret: chromium_ax_close_failed",
    );

    expect(failure).toEqual({
      code: "browser_tab_not_found",
      diagnostic: null,
    });
    expect(JSON.stringify(failure)).not.toContain("example.com");
    expect(JSON.stringify(failure)).not.toContain("token=secret");
  });

  it("classifies legacy object-shaped bridge errors without retaining their message", () => {
    const failure = normalizeExtremeNudgeFailure({
      message: "Not authorized to send Apple events to https://example.com/private (-1743)",
    });

    expect(failure).toEqual({ code: "permission_denied", diagnostic: null });
    expect(JSON.stringify(failure)).not.toContain("example.com");
  });

  it("preserves an already-normalized failure across the bridge error wrapper", () => {
    const wrapped = new ExtremeNudgeApplyError({
      code: "permission_denied",
      diagnostic: "apple_events_permission_denied",
    });

    expect(getExtremeNudgeFailure(wrapped)).toEqual(wrapped.failure);
    expect(wrapped.message).not.toContain("apple_events_permission_denied");
  });
});
