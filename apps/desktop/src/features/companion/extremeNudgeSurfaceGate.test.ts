import { describe, expect, it } from "vitest";
import { canApplyExtremeNudgeToSurface } from "./driftAlarmData";
import type { ActivitySegment } from "@drifty/domain";

function segment(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "seg-nudge",
    startedAt: "2026-08-31T09:00:00.000Z",
    endedAt: "2026-08-31T09:05:00.000Z",
    durationSeconds: 300,
    appName: "Safari",
    bundleId: "com.apple.Safari",
    browserName: "Safari",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

describe("canApplyExtremeNudgeToSurface", () => {
  it("refuses to close an ambiguous social surface the AI did not confirm", () => {
    const profile = segment({ siteDomain: "instagram.com", siteUrl: "https://www.instagram.com/someprofile/" });

    expect(canApplyExtremeNudgeToSurface({ segment: profile, category: "social_media", aiConfirmedDrift: false })).toBe(false);
    expect(canApplyExtremeNudgeToSurface({ segment: profile, category: "social_media", aiConfirmedDrift: true })).toBe(true);
  });

  it("honors a verdict the user already established instead of demanding a fresh AI pass", () => {
    const profile = segment({ siteDomain: "instagram.com", siteUrl: "https://www.instagram.com/someprofile/" });

    for (const classificationSource of ["manual", "rule", "llm"] as const) {
      expect(
        canApplyExtremeNudgeToSurface({ segment: profile, category: "social_media", aiConfirmedDrift: false, classificationSource }),
        classificationSource,
      ).toBe(true);
    }

    // A bare heuristic verdict is not a user decision and still needs the gate.
    expect(canApplyExtremeNudgeToSurface({
      segment: profile,
      category: "social_media",
      aiConfirmedDrift: false,
      classificationSource: "domain-db",
    })).toBe(false);
  });

  it("still closes social consumption surfaces without waiting on the AI", () => {
    const reels = segment({ siteDomain: "instagram.com", siteUrl: "https://www.instagram.com/reels/AAA/" });

    expect(canApplyExtremeNudgeToSurface({ segment: reels, category: "social_media", aiConfirmedDrift: false })).toBe(true);
  });

  it("leaves non-social drift and the communication exemption unchanged", () => {
    const netflix = segment({ siteDomain: "netflix.com", siteUrl: "https://netflix.com/watch/1" });

    expect(canApplyExtremeNudgeToSurface({ segment: netflix, category: "entertainment", aiConfirmedDrift: false })).toBe(true);
    expect(canApplyExtremeNudgeToSurface({ segment: netflix, category: "communication", aiConfirmedDrift: true })).toBe(false);
  });
});
