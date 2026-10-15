import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { hasClassifiedDashboardResult } from "./hasClassifiedDashboardResult";

const base = {
  id: "local-only", appName: "Editor", bundleId: "app.editor", durationSeconds: 60,
  startedAt: "2026-09-06T01:00:00Z", endedAt: "2026-09-06T01:01:00Z", source: "nsworkspace", platform: "macos",
  classification: { source: "llm", confidence: 0.9, category: "workspace", productivity: "focus", aiResult: true },
} satisfies ActivitySegment;

describe("classified dashboard result eligibility", () => {
  it("accepts displayed saved AI and manual results", () => {
    expect(hasClassifiedDashboardResult([base], {})).toBe(true);
    expect(hasClassifiedDashboardResult([{ ...base, classification: { ...base.classification, source: "manual", aiResult: false } }], {})).toBe(true);
  });
  it("excludes empty, raw, unknown, fallback, stale, hidden AI and zero-duration activity", () => {
    expect(hasClassifiedDashboardResult([], {})).toBe(false);
    expect(hasClassifiedDashboardResult([{ ...base, classification: null }], {})).toBe(false);
    expect(hasClassifiedDashboardResult([{ ...base, durationSeconds: 0 }], {})).toBe(false);
    expect(hasClassifiedDashboardResult([base], { includeAiClassifications: false })).toBe(false);
    for (const classification of [
      { ...base.classification, category: "unknown" as const },
      { ...base.classification, source: "fallback" as const },
      { ...base.classification, stale: true },
      { ...base.classification, source: "rule" as const },
    ]) expect(hasClassifiedDashboardResult([{ ...base, classification }], {})).toBe(false);
    expect(hasClassifiedDashboardResult([{ ...base, classification: { ...base.classification, source: "rule", aiResult: false, classificationRuleId: "rule-local" } }], {})).toBe(true);
    expect(hasClassifiedDashboardResult([{ ...base, classification: { ...base.classification, source: "rule", aiResult: false, ruleSnapshotKind: "synced-rule" } }], {})).toBe(true);
  });
});
