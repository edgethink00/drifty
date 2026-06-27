import { describe, expect, it } from "vitest";
import type { ActivitySegment, ClassificationOptions } from "@drifty/domain";
import { buildDriftAlarmManualCorrectionRuleInput } from "./driftAlarmManualCorrection";

const classificationOptions: ClassificationOptions = {};

function segment(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "not-drift-segment",
    startedAt: "2026-06-27T09:00:00.000Z",
    endedAt: "2026-06-27T09:05:00.000Z",
    durationSeconds: 300,
    appName: "Safari",
    platform: "macos",
    source: "accessibility",
    ...overrides,
  };
}

describe("buildDriftAlarmManualCorrectionRuleInput", () => {
  it("builds a URL detail site rule when a browser segment has a canonical URL target", () => {
    expect(buildDriftAlarmManualCorrectionRuleInput({
      classificationOptions,
      segment: segment({
        browserName: "Safari",
        siteDomain: "youtube.com",
        siteUrl: "https://www.youtube.com/watch?v=ABC123&t=90s&utm_source=share",
        siteTitle: "Video",
        windowTitle: "Video - YouTube",
      }),
    })).toMatchObject({
      targetKind: "site",
      targetValue: "youtube.com",
      matchScope: "detail",
      detailKind: "siteUrl",
      detailValue: "https://youtube.com/watch?v=ABC123",
      enabled: true,
      confidence: 1,
    });
  });

  it("builds a window-title detail app rule when a non-browser app segment has a window title", () => {
    expect(buildDriftAlarmManualCorrectionRuleInput({
      classificationOptions,
      segment: segment({
        appName: "Steam",
        bundleId: "com.valvesoftware.steam",
        windowTitle: "Store - Counter-Strike 2",
      }),
    })).toMatchObject({
      targetKind: "app",
      targetValue: "com.valvesoftware.steam",
      matchScope: "detail",
      detailKind: "windowTitle",
      detailValue: "Store - Counter-Strike 2",
    });
  });

  it("falls back to window-title or app rules only when URL detail targets are unavailable", () => {
    expect(buildDriftAlarmManualCorrectionRuleInput({
      classificationOptions,
      segment: segment({
        browserName: "Safari",
        appName: "Safari",
        bundleId: "com.apple.Safari",
        siteDomain: "example.com",
        siteUrl: "chrome://newtab",
        windowTitle: "Example Docs - Safari",
      }),
    })).toMatchObject({
      targetKind: "app",
      targetValue: "com.apple.Safari",
      matchScope: "detail",
      detailKind: "windowTitle",
      detailValue: "Example Docs - Safari",
    });

    expect(buildDriftAlarmManualCorrectionRuleInput({
      classificationOptions,
      segment: segment({
        appName: "Linear",
        bundleId: "com.linear",
        windowTitle: "   ",
      }),
    })).toMatchObject({
      targetKind: "app",
      targetValue: "com.linear",
      matchScope: "surface",
      detailKind: null,
      detailValue: null,
    });
  });
});
