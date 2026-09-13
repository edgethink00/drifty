import { describe, expect, it } from "vitest";
import {
  DEV_SETTINGS_SUBSECTIONS,
  resolveDevSettingsReviewSubsection,
  resolveDevSettingsSubsection,
} from "./devSettingsNavigation";

describe("devSettingsNavigation", () => {
  it("keeps Diagnostics as the primary and default Dev workspace", () => {
    expect(DEV_SETTINGS_SUBSECTIONS[0].id).toBe("diagnostics");
    expect(resolveDevSettingsSubsection(null)).toBe("diagnostics");
  });

  it("preserves every supported persisted subsection", () => {
    for (const subsection of DEV_SETTINGS_SUBSECTIONS) {
      expect(resolveDevSettingsSubsection(subsection.id)).toBe(subsection.id);
    }
  });

  it("falls back to Diagnostics for missing or stale persisted values", () => {
    for (const value of [null, "", "unknown", "diagnostic"]) {
      expect(resolveDevSettingsSubsection(value)).toBe("diagnostics");
    }
  });

  it("migrates the former five-way navigation to the four task groups", () => {
    expect(resolveDevSettingsSubsection("featureFlags")).toBe("flags");
    expect(resolveDevSettingsSubsection("uiFlows")).toBe("previews");
    expect(resolveDevSettingsSubsection("petCompanion")).toBe("lab");
    expect(resolveDevSettingsSubsection("aiCapture")).toBe("diagnostics");
  });

  it("resolves a development-only direct review entry point", () => {
    expect(resolveDevSettingsReviewSubsection("?review=dev-settings&subsection=previews", true)).toBe("previews");
    expect(resolveDevSettingsReviewSubsection("?review=dev-settings", true)).toBe("diagnostics");
    expect(resolveDevSettingsReviewSubsection("?review=dev-settings&subsection=lab", false)).toBeNull();
    expect(resolveDevSettingsReviewSubsection("?subsection=lab", true)).toBeNull();
  });
});
