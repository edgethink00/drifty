import { describe, expect, it } from "vitest";

import type { LiveClassificationMemoryContext, LiveClassificationPromptItem } from "@drifty/domain";

import {
  CONTEXTUAL_GUARD_AUDIT_RETENTION_MS,
  buildContextualGuardAuditEvent,
  readContextualGuardAuditEvents,
  recordContextualGuardAuditEvent,
} from "./contextualGuardAuditLog";

const item: LiveClassificationPromptItem = {
  id: "segment-1",
  appName: "Instagram",
  domain: "instagram.com",
  title: "Reel",
  durationSeconds: 95,
};

function memory(overrides: Partial<LiveClassificationMemoryContext> = {}): LiveClassificationMemoryContext {
  return {
    soul: {
      revision: 4,
      declared: { workActivities: [], workDomain: null, purpose: null },
      learnedWorkSupport: [],
      matchedContextualWorkSupport: [{ summary: "Matched work context", confidence: "medium", evidenceCount: 5 }],
      learnedDrift: [],
      ambiguities: [],
    },
    episodeByItemId: {
      "segment-1": {
        windowMinutes: 30,
        observedMinutes: 3,
        dominantSurface: "instagram.com",
        currentSurfaceSeconds: 95,
        transitions: [
          { appName: "Messages", title: "Contact", durationSeconds: 35 },
          { appName: "Instagram", domain: "instagram.com", title: "Reel", durationSeconds: 95 },
        ],
      },
    },
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof buildContextualGuardAuditEvent>[0]> = {}) {
  return {
    route: "cloud" as const,
    category: "social_media" as const,
    rawProductivity: "drift" as const,
    finalProductivity: "neutral" as const,
    rawConfidence: 0.91,
    finalConfidence: 0.5,
    promptVersion: "v8.2-soul-episode-v2",
    item,
    memoryContext: memory(),
    ...overrides,
  };
}

describe("contextual guard audit log", () => {
  it("records only bounded decision metadata for an applied mature match", () => {
    const event = buildContextualGuardAuditEvent(input(), new Date("2026-08-16T00:00:00.000Z"));
    expect(event).toEqual({
      schemaVersion: 1,
      recordedAt: "2026-08-16T00:00:00.000Z",
      route: "cloud",
      outcome: "applied",
      reason: "applied",
      category: "social_media",
      rawProductivity: "drift",
      finalProductivity: "neutral",
      rawConfidence: 0.91,
      finalConfidence: 0.5,
      evidenceCount: 5,
      matchConfidence: "medium",
      soulRevision: 4,
      currentDurationBucket: "1_to_3m",
      promptVersion: "v8.2-soul-episode-v2",
    });
    expect(JSON.stringify(event)).not.toMatch(/Instagram|Messages|Contact|instagram\.com|segment-1/);
  });

  it("explains retained sustained use and ignores requests without an exact match", () => {
    const sustainedMemory = memory({
      episodeByItemId: {
        "segment-1": {
          ...memory().episodeByItemId["segment-1"],
          currentSurfaceSeconds: 650,
        },
      },
    });
    expect(buildContextualGuardAuditEvent(input({
      finalProductivity: "drift",
      memoryContext: sustainedMemory,
    }))?.reason).toBe("sustained_use");
    expect(buildContextualGuardAuditEvent(input({
      memoryContext: { soul: memory().soul ? { ...memory().soul!, matchedContextualWorkSupport: [] } : null, episodeByItemId: memory().episodeByItemId },
    }))).toBeNull();
  });

  it("classifies every retained matched-guard boundary without exposing activity text", () => {
    expect(buildContextualGuardAuditEvent(input({
      category: "game",
      finalProductivity: "drift",
    }))?.reason).toBe("protected_category");
    expect(buildContextualGuardAuditEvent(input({
      finalProductivity: "drift",
      memoryContext: memory({
        soul: {
          ...memory().soul!,
          matchedContextualWorkSupport: [{ summary: "Candidate", confidence: "low", evidenceCount: 3 }],
        },
      }),
    }))?.reason).toBe("immature_match");
    expect(buildContextualGuardAuditEvent(input({
      finalProductivity: "drift",
      memoryContext: memory({ episodeByItemId: {} }),
    }))?.reason).toBe("missing_episode");
    expect(buildContextualGuardAuditEvent(input({
      finalProductivity: "drift",
    }))?.reason).toBe("decision_mismatch");
  });

  it("prunes expired events and coalesces identical decisions within one minute", () => {
    const storage = new MemoryStorage();
    const start = new Date("2026-08-01T00:00:00.000Z");
    recordContextualGuardAuditEvent(input(), storage, start);
    recordContextualGuardAuditEvent(input(), storage, new Date(start.getTime() + 30_000));
    expect(readContextualGuardAuditEvents(storage, start.getTime() + 30_000)).toHaveLength(1);
    expect(readContextualGuardAuditEvents(storage, start.getTime() + 30_000 + CONTEXTUAL_GUARD_AUDIT_RETENTION_MS + 1)).toEqual([]);
    expect(storage.getItem("drifty.classification.contextualGuardAudit.v1")).toBe("[]");
  });

  it("does not touch storage for ordinary requests without an exact contextual match", () => {
    const storage = new MemoryStorage();
    const unmatched = memory({
      soul: { ...memory().soul!, matchedContextualWorkSupport: [] },
    });

    expect(recordContextualGuardAuditEvent(input({ memoryContext: unmatched }), storage)).toEqual([]);
    expect(storage.length).toBe(0);
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
