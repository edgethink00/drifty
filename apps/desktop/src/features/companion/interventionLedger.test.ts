import { describe, expect, it } from "vitest";
import { recordDriftAlarmDebugEvent, type DriftAlarmDebugEvent } from "./driftAlarmDebugLog";
import {
  INTERVENTION_LEDGER_LIMIT,
  INTERVENTION_LEDGER_STORAGE_KEY,
  appendInterventionLedgerEvent,
  buildInterventionLedgerDebugInput,
  clearInterventionLedger,
  readInterventionLedger,
  summarizeInterventionLedger,
  toInterventionLedgerEntry,
} from "./interventionLedger";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) { this.items.set(key, value); }
}

const NOW = new Date("2026-09-18T09:00:00.000Z");

function event(overrides: Partial<DriftAlarmDebugEvent> & { kind: DriftAlarmDebugEvent["kind"] }): DriftAlarmDebugEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    recordedAt: NOW.toISOString(),
    alertKey: "alert-1",
    result: null,
    reason: null,
    message: null,
    segment: null,
    currentSnapshot: null,
    candidate: null,
    ai: null,
    delivery: null,
    trayResult: null,
    evaluation: null,
    candidateProbe: null,
    ...overrides,
  };
}

describe("interventionLedger", () => {
  it("keeps only outcome kinds and strips activity identifiers", () => {
    expect(toInterventionLedgerEntry(event({ kind: "candidate_detected" }))).toBeNull();

    const entry = toInterventionLedgerEntry(event({
      kind: "extreme_nudge_result",
      result: "not_applied",
      reason: "browser_tab_selected_mismatch",
      candidate: {
        alertKey: "alert-1",
        episodeKey: "episode-1",
        driftDurationSeconds: 130,
        category: "entertainment",
        sourceSegmentId: "seg-1",
        segment: {
          id: "seg-1",
          sourceSegmentId: null,
          startedAt: NOW.toISOString(),
          endedAt: NOW.toISOString(),
          durationSeconds: 130,
          appName: "Aside",
          bundleId: "com.aside.browser",
          browserName: "Aside",
          siteDomain: "youtube.com",
          youtubeVideoId: "abc",
          youtubeIsShorts: true,
          youtubeUrlPathKind: "shorts",
          hasSiteContext: true,
          siteSource: "applescript",
          browserAutomationStatus: "ok",
          hasBrowserAutomationError: false,
          classification: null,
        },
      },
    }));

    expect(entry).toMatchObject({
      kind: "extreme_nudge_result",
      result: "not_applied",
      reason: "browser_tab_selected_mismatch",
      browserName: "Aside",
      category: "entertainment",
      siteSource: "applescript",
      hasSiteContext: true,
    });
    expect(JSON.stringify(entry)).not.toContain("youtube.com");
    expect(JSON.stringify(entry)).not.toContain("abc");
  });

  it("is appended by recordDriftAlarmDebugEvent and survives the 5-minute debug log window", () => {
    const storage = new MemoryStorage();
    recordDriftAlarmDebugEvent({ kind: "extreme_nudge_started", alertKey: "a" }, storage, NOW);
    recordDriftAlarmDebugEvent({ kind: "candidate_detected", alertKey: "a" }, storage, NOW);
    recordDriftAlarmDebugEvent({ kind: "extreme_nudge_result", alertKey: "a", result: "applied", reason: "closed_browser_tab" }, storage, NOW);

    const later = NOW.getTime() + 2 * 24 * 60 * 60 * 1000;
    const entries = readInterventionLedger(storage, later);
    expect(entries.map((entry) => entry.kind)).toEqual(["extreme_nudge_started", "extreme_nudge_result"]);
  });

  it("prunes entries older than 30 days and caps the ledger size", () => {
    const storage = new MemoryStorage();
    const old = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    appendInterventionLedgerEvent(event({ kind: "delivery_delivered", recordedAt: old }), storage, NOW);
    appendInterventionLedgerEvent(event({ kind: "delivery_delivered" }), storage, NOW);
    expect(readInterventionLedger(storage, NOW.getTime())).toHaveLength(1);

    const many = Array.from({ length: INTERVENTION_LEDGER_LIMIT + 5 }, (_, index) => ({
      id: `e-${index}`,
      recordedAt: NOW.toISOString(),
      kind: "delivery_delivered",
      alertKey: null, result: null, reason: null, message: null,
      browserName: null, category: null, siteSource: null, hasSiteContext: null, deliveryMode: null,
    }));
    storage.setItem(INTERVENTION_LEDGER_STORAGE_KEY, JSON.stringify(many));
    appendInterventionLedgerEvent(event({ kind: "delivery_delivered", id: "newest" }), storage, NOW);
    const capped = readInterventionLedger(storage, NOW.getTime());
    expect(capped).toHaveLength(INTERVENTION_LEDGER_LIMIT);
    expect(capped[capped.length - 1]?.id).toBe("newest");
  });

  it("ignores malformed storage and never throws on write failure", () => {
    const storage = new MemoryStorage();
    storage.setItem(INTERVENTION_LEDGER_STORAGE_KEY, "{not json");
    expect(readInterventionLedger(storage, NOW.getTime())).toEqual([]);
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => appendInterventionLedgerEvent(event({ kind: "delivery_delivered" }), storage, NOW)).not.toThrow();
  });

  it("summarizes attempts, outcomes, reasons and browsers within a window", () => {
    const storage = new MemoryStorage();
    const seg = (browserName: string) => ({
      alertKey: "a", episodeKey: "e", driftDurationSeconds: 1, category: "entertainment" as const, sourceSegmentId: null,
      segment: {
        id: "s", sourceSegmentId: null, startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), durationSeconds: 1,
        appName: browserName, bundleId: null, browserName, siteDomain: null, youtubeVideoId: null, youtubeIsShorts: null,
        youtubeUrlPathKind: "other" as const, hasSiteContext: true, siteSource: null, browserAutomationStatus: null,
        hasBrowserAutomationError: false, classification: null,
      },
    });
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    for (const e of [
      event({ kind: "delivery_delivered" }),
      event({ kind: "delivery_suppressed" }),
      event({ kind: "extreme_nudge_started", candidate: seg("Aside") }),
      event({ kind: "extreme_nudge_result", result: "applied", candidate: seg("Aside") }),
      event({ kind: "extreme_nudge_started", candidate: seg("Google Chrome") }),
      event({ kind: "extreme_nudge_result", result: "not_applied", reason: "pet_intercepted", candidate: seg("Google Chrome") }),
      event({ kind: "extreme_nudge_pet_skipped", reason: "target_unavailable:browser_tab_selected_mismatch" }),
      // App records the outcome class as the reason and the detail before the elapsed time.
      event({ kind: "extreme_nudge_pet_skipped", reason: "rejected", message: "target_unavailable:windows_uia_target_mismatch elapsedMs=812" }),
      event({ kind: "extreme_nudge_pet_skipped", reason: "timed_out", message: "elapsedMs=8000" }),
      event({ kind: "extreme_nudge_error", reason: "ax_permission_denied" }),
      event({ kind: "extreme_nudge_error", reason: "browser_tab_not_found", message: "windows_uia_document_unavailable" }),
      event({ kind: "extreme_nudge_started", recordedAt: eightDaysAgo, candidate: seg("Safari") }),
    ]) appendInterventionLedgerEvent(e, storage, NOW);

    const entries = readInterventionLedger(storage, NOW.getTime());
    const week = summarizeInterventionLedger(entries, 7, NOW.getTime());
    expect(week).toMatchObject({
      delivered: 1, suppressed: 1, closeAttempts: 2, closeApplied: 1, closeNotApplied: 1, petSkipped: 3, errors: 2,
      notAppliedDiagnostics: { pet_intercepted: 1 },
      petSkipReasons: { "target_unavailable:browser_tab_selected_mismatch": 1, rejected: 1, timed_out: 1 },
      petSkipDetails: { "target_unavailable:windows_uia_target_mismatch": 1, unknown: 2 },
      errorCodes: { ax_permission_denied: 1, browser_tab_not_found: 1 },
      errorDiagnostics: { windows_uia_document_unavailable: 1, unknown: 1 },
      byBrowser: { Aside: { attempts: 1, applied: 1 }, "Google Chrome": { attempts: 1, applied: 0 } },
    });
    expect(summarizeInterventionLedger(entries, 30, NOW.getTime()).closeAttempts).toBe(3);

    const debug = buildInterventionLedgerDebugInput(storage, NOW.getTime());
    expect(debug.retentionDays).toBe(30);
    expect(debug.last7Days.closeAttempts).toBe(2);
    expect(debug.entries).toHaveLength(12);

    clearInterventionLedger(storage);
    expect(readInterventionLedger(storage, NOW.getTime())).toEqual([]);
  });
});
