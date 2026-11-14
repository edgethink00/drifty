import type {
  ActivitySegment,
  LiveClassificationMemoryContext,
} from "@drifty/domain";
import { describe, expect, it } from "vitest";

import { toMinimizedPayload } from "./aiClassificationService";
import { buildCorrectionEvidenceRecord } from "./correctionEvidence";
import {
  parseCorrectionEvidenceRecord,
  type CorrectionEvidenceRecord,
} from "./correctionEvidenceContract";

const HASH = "a".repeat(64);

function segment(): ActivitySegment {
  return {
    id: "raw-segment-id",
    startedAt: "2026-08-16T00:00:00.000Z",
    endedAt: "2026-08-16T00:02:00.000Z",
    durationSeconds: 120,
    appName: "Google Chrome",
    platform: "macos",
    source: "accessibility",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    siteDomain: "instagram.com",
    siteUrl: "https://instagram.com/reel/business-reference?account=private#clip",
    siteTitle: "Business reference reel",
    windowTitle: "Private workspace title",
    classification: {
      category: "social_media",
      productivity: "drift",
      source: "llm",
      confidence: 0.91,
      inputFingerprint: HASH,
      model: "local-model",
      promptVersion: "v8",
      aiResult: true,
    },
  };
}

function memory(segmentId: string): LiveClassificationMemoryContext {
  return {
    soul: {
      revision: 3,
      declared: {
        workActivities: ["Product research"],
        workDomain: "Media",
        purpose: "Protect focus",
      },
      learnedWorkSupport: [],
      learnedDrift: [],
      ambiguities: [],
    },
    episodeByItemId: {
      [segmentId]: {
        windowMinutes: 30,
        observedMinutes: 4,
        dominantSurface: "instagram.com",
        currentSurfaceSeconds: 120,
        transitions: [{
          appName: "Google Chrome",
          domain: "instagram.com",
          title: "Business reference reel",
          durationSeconds: 120,
        }],
      },
    },
  };
}

const privacy = {
  siteUrl: true,
  windowTitle: true,
  contentContext: true,
  workProfile: true,
  screenText: true,
} as const;

describe("correction evidence", () => {
  it("records Not a drift as a partial label without raw tracker identifiers", async () => {
    const current = segment();
    const memoryContext = memory(current.id);
    const payload = await toMinimizedPayload(current, null, { version: 1, optional: privacy }, memoryContext);
    const record = await buildCorrectionEvidenceRecord({
      feedback: {
        kind: "not_drift",
        segment: current,
        correctedCategory: "social_media",
        correctedProductivity: "neutral",
        occurredAt: "2026-08-16T00:02:10.000Z",
      },
      correctionScope: "alarm",
      classificationOptions: { includeAiClassifications: true },
      privacy,
      payload,
      memoryContext,
      predictionBeforeFeedback: {
        category: "entertainment",
        productivity: "drift",
        confidence: 0.86,
        source: "llm",
      },
    });

    expect(record.feedback).toEqual({
      kind: "not_drift",
      scope: "alarm",
      productivityConstraint: "not_drift",
    });
    expect(record.predictionBeforeFeedback).toMatchObject({
      category: "entertainment",
      productivity: "drift",
      confidence: 0.86,
      source: "llm",
    });
    expect(record.promptInput.item).toMatchObject({
      id: "current",
      siteUrl: "https://instagram.com/reel/business-reference",
    });
    expect(record.promptInput.memoryContext.episodeByItemId).toHaveProperty("current");
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("raw-segment-id");
    expect(serialized).not.toContain("startedAt");
    expect(serialized).not.toContain("endedAt");
    expect(serialized).not.toContain("account=private");
  });

  it("keeps an explicit classification correction as an exact label", async () => {
    const current = segment();
    const memoryContext = memory(current.id);
    const payload = await toMinimizedPayload(current, null, { version: 1, optional: privacy }, memoryContext);
    const record = await buildCorrectionEvidenceRecord({
      feedback: {
        kind: "manual_correction",
        segment: current,
        correctedCategory: "learning",
        correctedProductivity: "focus",
        occurredAt: "2026-08-16T00:02:10.000Z",
      },
      correctionScope: "detail",
      classificationOptions: { includeAiClassifications: true },
      privacy,
      payload,
      memoryContext,
    });

    expect(record.feedback).toEqual({
      kind: "manual_correction",
      scope: "detail",
      category: "learning",
      productivity: "focus",
    });
    expect(record.predictionBeforeFeedback.productivity).toBe("drift");
  });

  it("does not restore prompt fields disabled by privacy settings", async () => {
    const current = segment();
    current.classification = { ...current.classification!, inputFingerprint: null };
    const privateOff = {
      siteUrl: false,
      windowTitle: false,
      contentContext: false,
      workProfile: false,
      screenText: false,
    } as const;
    const memoryContext: LiveClassificationMemoryContext = {
      soul: null,
      episodeByItemId: {
        [current.id]: {
          windowMinutes: 30,
          observedMinutes: 2,
          dominantSurface: "instagram.com",
          currentSurfaceSeconds: 120,
          transitions: [{ appName: "Google Chrome", domain: "instagram.com", durationSeconds: 120 }],
        },
      },
    };
    const payload = await toMinimizedPayload(current, null, { version: 1, optional: privateOff }, memoryContext);
    const record = await buildCorrectionEvidenceRecord({
      feedback: {
        kind: "not_drift",
        segment: current,
        correctedCategory: "social_media",
        correctedProductivity: "neutral",
        occurredAt: "2026-08-16T00:02:10.000Z",
      },
      correctionScope: "alarm",
      classificationOptions: { includeAiClassifications: true },
      privacy: privateOff,
      payload,
      memoryContext,
    });

    expect(record.promptInput.memoryContext.soul).toBeNull();
    expect(record.promptInput.item).not.toHaveProperty("siteUrl");
    expect(record.promptInput.item).not.toHaveProperty("windowTitle");
    expect(record.promptInput.item).not.toHaveProperty("title");
    expect(record.predictionBeforeFeedback.inputFingerprint).toMatch(/^drifty-v3-[a-f0-9]{64}$/);
  });

  it("rejects extra raw identifiers and fabricated fields on a partial label", async () => {
    const current = segment();
    const memoryContext = memory(current.id);
    const payload = await toMinimizedPayload(current, null, { version: 1, optional: privacy }, memoryContext);
    const valid = await buildCorrectionEvidenceRecord({
      feedback: {
        kind: "not_drift",
        segment: current,
        correctedCategory: "social_media",
        correctedProductivity: "neutral",
        occurredAt: "2026-08-16T00:02:10.000Z",
      },
      correctionScope: "alarm",
      classificationOptions: { includeAiClassifications: true },
      privacy,
      payload,
      memoryContext,
    });
    const withRawId = structuredClone(valid) as CorrectionEvidenceRecord & { segmentId: string };
    withRawId.segmentId = "raw";
    expect(() => parseCorrectionEvidenceRecord(withRawId)).toThrow(/keys are invalid/i);
    const fabricated = structuredClone(valid) as unknown as { feedback: Record<string, unknown> };
    fabricated.feedback.category = "learning";
    expect(() => parseCorrectionEvidenceRecord(fabricated)).toThrow(/keys are invalid/i);
  });
});
