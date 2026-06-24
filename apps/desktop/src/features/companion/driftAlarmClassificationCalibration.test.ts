import { classifyActivityDetailed } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ProductivityLabel, StoredActivityClassification } from "@drifty/domain";
import { describe, expect, it } from "vitest";

import { calibrateAppLlmClassificationWithHistory } from "./driftAlarmClassificationCalibration";

describe("calibrateAppLlmClassificationWithHistory", () => {
  it("does not calibrate browser LLM classifications", () => {
    const current = segment({
      id: "browser-current",
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: "instagram.com",
      classification: storedClassification({ category: "social_media", productivity: "drift", confidence: 0.96 }),
    });
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: focusHistorySegments(12, { appName: "Google Chrome", bundleId: "com.google.Chrome" }),
      classificationOptions: {},
    });

    expect(rawClassification.surface).toBe("browser");
    expect(result.action).toBe("none");
    expect(result.classification).toBe(rawClassification);
  });

  it("downranks app LLM drift during cold start", () => {
    const current = appLlmOutlierSegment();
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: focusHistorySegments(2),
      classificationOptions: {},
    });

    expect(result.action).toBe("cold_start_downranked");
    expect(result.classification.confidence).toBe(0.7);
    expect(result.classification.category).toBe("social_media");
    expect(result.classification.productivity).toBe("drift");
  });

  it("keeps app LLM classifications unchanged after cold start when statistical support is still too small", () => {
    const current = appLlmOutlierSegment();
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: focusHistorySegments(4),
      classificationOptions: {},
    });

    expect(result.action).toBe("none");
    expect(result.classification.confidence).toBe(0.96);
  });

  it("downranks rare app LLM outliers below the drift alarm confidence gate", () => {
    const current = appLlmOutlierSegment();
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: focusHistorySegments(6),
      classificationOptions: {},
    });

    expect(result.action).toBe("confidence_downranked");
    expect(result.classification).toMatchObject({
      category: "social_media",
      productivity: "drift",
      confidence: 0.72,
      source: "llm",
    });
    expect(result.classification.reason).toContain("app history calibration");
  });

  it("keeps mild app history outliers above the drift alarm confidence gate", () => {
    const current = appLlmOutlierSegment();
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: [
        ...focusHistorySegments(5),
        ...neutralHistorySegments(2),
      ],
      classificationOptions: {},
    });

    expect(result.action).toBe("confidence_downranked");
    expect(result.classification).toMatchObject({
      category: "social_media",
      productivity: "drift",
      confidence: 0.88,
      source: "llm",
    });
  });

  it("overrides to dominant app history with low confidence when evidence is overwhelming", () => {
    const current = appLlmOutlierSegment();
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: focusHistorySegments(12, { durationSeconds: 15 * 60 }),
      classificationOptions: {},
    });

    expect(result.action).toBe("overrode_to_dominant_history");
    expect(result.classification).toMatchObject({
      category: "workspace",
      productivity: "focus",
      confidence: 0.7,
      source: "llm",
    });
  });

  it("does not calibrate non-LLM app classifications", () => {
    const current = segment({
      id: "manual-current",
      classification: storedClassification({
        category: "social_media",
        productivity: "drift",
        source: "manual",
        confidence: 1,
      }),
    });
    const rawClassification = classifyActivityDetailed(current);

    const result = calibrateAppLlmClassificationWithHistory({
      segment: current,
      classification: rawClassification,
      historySegments: focusHistorySegments(12, { durationSeconds: 15 * 60 }),
      classificationOptions: {},
    });

    expect(rawClassification.source).toBe("manual");
    expect(result.action).toBe("none");
    expect(result.classification).toBe(rawClassification);
  });
});

function appLlmOutlierSegment(): ActivitySegment {
  return segment({
    id: "obsidian-current",
    offsetMinutes: 240,
    windowTitle: "Instagram reels notes",
    classification: storedClassification({ category: "social_media", productivity: "drift", confidence: 0.96 }),
  });
}

function focusHistorySegments(
  count: number,
  overrides: { readonly appName?: string; readonly bundleId?: string; readonly durationSeconds?: number } = {},
): ActivitySegment[] {
  return Array.from({ length: count }, (_, index) => (
    segment({
      id: `focus-${index}`,
      offsetMinutes: index * 20,
      appName: overrides.appName ?? "Obsidian",
      bundleId: overrides.bundleId ?? "md.obsidian",
      durationSeconds: overrides.durationSeconds ?? 10 * 60,
      windowTitle: "Project notes",
      classification: storedClassification({ category: "workspace", productivity: "focus", confidence: 0.94 }),
    })
  ));
}

function neutralHistorySegments(count: number): ActivitySegment[] {
  return Array.from({ length: count }, (_, index) => (
    segment({
      id: `neutral-${index}`,
      offsetMinutes: 300 + index * 20,
      windowTitle: "Inbox notes",
      classification: storedClassification({ category: "communication", productivity: "neutral", confidence: 0.94 }),
    })
  ));
}

function segment({
  id,
  offsetMinutes = 0,
  durationSeconds = 10 * 60,
  appName = "Obsidian",
  bundleId = "md.obsidian",
  browserName = null,
  siteDomain = null,
  windowTitle = "Notes",
  classification,
}: {
  readonly id: string;
  readonly offsetMinutes?: number;
  readonly durationSeconds?: number;
  readonly appName?: string;
  readonly bundleId?: string;
  readonly browserName?: string | null;
  readonly siteDomain?: string | null;
  readonly windowTitle?: string;
  readonly classification: StoredActivityClassification;
}): ActivitySegment {
  const startedAtMs = Date.UTC(2026, 5, 24, 9, offsetMinutes, 0, 0);
  const endedAtMs = startedAtMs + durationSeconds * 1000;

  return {
    id,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationSeconds,
    appName,
    bundleId,
    windowTitle,
    browserName,
    siteDomain,
    siteTitle: siteDomain,
    platform: "macos",
    source: "nsworkspace",
    classification,
  };
}

function storedClassification({
  category,
  productivity,
  confidence,
  source = "llm",
}: {
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
  readonly confidence: number;
  readonly source?: StoredActivityClassification["source"];
}): StoredActivityClassification {
  return {
    source,
    category,
    productivity,
    confidence,
    reason: "test classification",
    aiResult: source === "llm",
  };
}
