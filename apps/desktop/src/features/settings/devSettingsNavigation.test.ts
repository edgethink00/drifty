import { describe, expect, it } from "vitest";
import {
  DEV_SETTINGS_SUBSECTIONS,
  resolveDevSettingsSubsection,
} from "./devSettingsNavigation";

describe("devSettingsNavigation", () => {
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
});
