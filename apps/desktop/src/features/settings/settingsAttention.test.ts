import { describe, expect, it } from "vitest";
import { settingsSectionsNeedingAttention } from "./settingsAttention";

const missingGrant = {
  desktopRuntime: true,
  accessibilityRequired: true,
  accessibilityGranted: false,
  trackerMode: "running",
} as const;

describe("settingsSectionsNeedingAttention", () => {
  it("flags General when a live tracker reports the required Accessibility grant is off", () => {
    expect(settingsSectionsNeedingAttention(missingGrant)).toEqual(["general"]);
  });

  it("stays quiet when the grant is present or not required", () => {
    expect(settingsSectionsNeedingAttention({ ...missingGrant, accessibilityGranted: true })).toEqual([]);
    // Windows does not require Accessibility.
    expect(settingsSectionsNeedingAttention({ ...missingGrant, accessibilityRequired: false })).toEqual([]);
  });

  it("does not guess before a real reading exists", () => {
    expect(settingsSectionsNeedingAttention({ ...missingGrant, desktopRuntime: false })).toEqual([]);
    expect(settingsSectionsNeedingAttention({ ...missingGrant, trackerMode: null })).toEqual([]);
  });

  it.each(["unavailable", "degraded"])("does not blame a permission when the tracker is %s", (trackerMode) => {
    // Failed tracker calls synthesize accessibilityGranted: false; that is a tracker
    // problem the sidebar card already reports, not a revoked permission.
    expect(settingsSectionsNeedingAttention({ ...missingGrant, trackerMode })).toEqual([]);
  });
});
