import { describe, expect, it } from "vitest";
import type { ScreenContextStatus } from "@drifty/domain";
import type { MemoryStatus } from "../screen-context/memoryWire";
import { screenHealth, memoryHealth } from "./feedbackFeatureHealth";
import { projectFeedbackDiagnostics } from "@drifty/domain";

describe("feature health without evidence or remembered content", () => {
  it("projects known screen states and counters, never configured apps or screen text", () => {
    const health = screenHealth({ preferences: { enabled: true, replayEnabled: true, ocrEnabled: true, allowedApps: ["private.client"] },
      helperInstalled: true, captureEnabled: true, globalPaused: false, paused: false, running: true, preparing: false,
      ocrSupported: true, preferencesInvalid: false, accepted: 9, dropped: 3, lastFailure: "text_deadline", lastAcceptedAtMs: 10_000,
      supportedApps: [{ id: "private.client", name: "Private work app" }], text: "Private screen" } as unknown as ScreenContextStatus, 15_000);
    expect(health).toMatchObject({ accepted: 9, dropped: 3, lastFailure: "text_deadline", lastAcceptedAgeSeconds: 5, ocrEnabled: true });
    expect(JSON.stringify(projectFeedbackDiagnostics({ screen: health }))).not.toContain("Private");
    expect(JSON.stringify(health)).not.toContain("private.client");
  });
  it("preserves memory route, limits and ages while excluding chosen sites and apps", () => {
    const health = memoryHealth({ supported: true, active: true, preferences: { enabled: true, retentionHours: 24, workSites: ["private.example"], apps: ["private.app"] },
      sources: 4, groups: 2, wikiPages: 3, error: null, route: { kind: "cloud", error: "credits_exhausted", embedding: "ready" },
      diagnostics: { phase: "limited", last_source_at_ms: 5_000, last_extracted_at_ms: 10_000, next_attempt_at_ms: 30_000,
        running: 0, waiting: 2, exhausted: 1, errors: 1, facts: 8, writes_hour: 3, writes_day: 6, queries_hour: 2,
        writes_hour_limit: 3, writes_day_limit: 100, queries_hour_limit: 10 } } as MemoryStatus, 15_000);
    expect(health).toMatchObject({ route: { kind: "cloud", error: "credits_exhausted" }, diagnostics: { phase: "limited", waiting: 2, lastSourceAgeSeconds: 10, nextAttemptInSeconds: 15 } });
    expect(JSON.stringify(projectFeedbackDiagnostics({ memory: health }))).not.toContain("private");
    expect(screenHealth(null, 0)).toBeNull(); expect(memoryHealth(null, 0)).toBeNull();
  });
});
