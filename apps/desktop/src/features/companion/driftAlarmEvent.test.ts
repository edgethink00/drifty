import { describe, expect, it } from "vitest";
import type { ActivityClassificationDetail } from "@drifty/domain";

import { isDriftAlarmEvent } from "./driftAlarmBridge";
import { buildDriftAlarmEvent } from "./driftAlarmEvent";

function event() {
  return buildDriftAlarmEvent({
    id: "alarm-1",
    contextLabel: "Example",
    driftDurationSeconds: 60,
    preservedFocusStrikeSeconds: 0,
    generatedAt: "2026-08-16T00:00:00.000Z",
    sourceSiteDomain: "example.com",
    sourceAppName: "Browser",
    sourceIconSrc: null,
    sourceSegmentId: "segment-1",
    decisionClassification: {
      category: "entertainment",
      productivity: "drift",
      confidence: 0.91,
      source: "llm",
      reason: "private provider reason",
      surface: "browser",
    } as ActivityClassificationDetail,
  });
}

describe("drift alarm decision snapshot", () => {
  it("keeps only the final decision fields needed for correction evidence", () => {
    const built = event();
    expect(built.decisionClassification).toEqual({
      category: "entertainment",
      productivity: "drift",
      confidence: 0.91,
      source: "llm",
    });
    expect(JSON.stringify(built)).not.toContain("private provider reason");
    expect(isDriftAlarmEvent(built)).toBe(true);
  });

  it("rejects an invalid decision confidence at the bridge", () => {
    const built = structuredClone(event()) as unknown as { decisionClassification: { confidence: number } };
    built.decisionClassification.confidence = 2;
    expect(isDriftAlarmEvent(built)).toBe(false);
  });
});
