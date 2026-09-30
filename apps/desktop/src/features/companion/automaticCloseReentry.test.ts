import { describe, expect, it } from "vitest";
import type { ActivitySegment, CurrentActivitySnapshot } from "@drifty/domain";
import { buildDriftAlarmCandidates } from "./driftAlarmData";
import { observeAutomaticCloseReentry, type AutomaticCloseReentry } from "./automaticCloseReentry";

const closedAtMs = Date.parse("2026-09-30T09:00:00Z");
const snapshot = (seconds: number): CurrentActivitySnapshot => ({
  observedAt: new Date(closedAtMs + seconds * 1000).toISOString(),
  appName: "Google Chrome", bundleId: "chrome.exe", browserName: "Google Chrome",
  siteDomain: "youtube.com", siteUrl: "https://youtube.com/watch?v=again", source: "win32-foreground",
  browserAutomationStatus: "granted",
});
const segment: ActivitySegment = {
  ...snapshot(-1), id: "before-close", platform: "windows", startedAt: new Date(closedAtMs - 60_000).toISOString(),
  endedAt: new Date(closedAtMs - 1000).toISOString(), durationSeconds: 59,
  classification: { category: "entertainment", productivity: "drift", confidence: 1, source: "manual" },
};
const candidate = buildDriftAlarmCandidates({ segments: [segment], currentSnapshot: snapshot(1), classificationOptions: {}, minimumDurationSeconds: 0 })[0]!;
const initial: AutomaticCloseReentry = { closedAtMs, entry: null };
const observe = (state: AutomaticCloseReentry, seconds: number, delay = 0, current: CurrentActivitySnapshot | null = snapshot(seconds)) => (
  observeAutomaticCloseReentry(state, candidate, current, closedAtMs + seconds * 1000, delay)
);

describe("automatic close reentry", () => {
  it("respects recovery grace with Instant, including the exact deadline", () => {
    const first = observe(initial, 1);
    expect(first.ready).toBe(false);
    expect(observe(first.state, 14.999).ready).toBe(false);
    expect(observe(first.state, 15).ready).toBe(true);
  });

  it("restarts configured delay from verified reentry and overlaps grace", () => {
    const first = observe(initial, 5, 30);
    expect(observe(first.state, 20, 30).ready).toBe(false);
    expect(observe(observe(first.state, 20, 30).state, 34.999, 30).ready).toBe(false);
    expect(observe(observe(first.state, 20, 30).state, 35, 30).ready).toBe(true);
  });

  it.each([0, -1, NaN, 100])("rejects stale, invalid or future timestamps (%s)", (seconds) => {
    const current = snapshot(0);
    current.observedAt = Number.isNaN(seconds) ? "invalid" : snapshot(seconds).observedAt;
    expect(observe(initial, 20, 0, current).ready).toBe(false);
  });

  it.each(["stale", "unavailable", "denied", "empty_result"] as const)("rejects cached addresses with %s status", (status) => {
    expect(observe(initial, 20, 0, { ...snapshot(20), browserAutomationStatus: status }).state.entry).toBeNull();
  });

  it("does not let unknown capture or an unobserved interval pay the delay", () => {
    const first = observe(initial, 1, 30);
    const missing = observe(first.state, 16, 30, null);
    expect(observe(missing.state, 31, 30).ready).toBe(false);
    expect(observe(first.state, 60, 30).ready).toBe(false);
  });

  it("rejects changed browser, site and stale YouTube metadata", () => {
    for (const changed of [{ bundleId: "msedge.exe" }, { siteDomain: "github.com" }, { siteUrl: "https://youtube.com/watch?v=different" }]) {
      expect(observe(initial, 20, 0, { ...snapshot(20), ...changed }).ready).toBe(false);
    }
  });

  it("starts another grace after the next physical close", () => {
    const nextClose = { closedAtMs: closedAtMs + 20_000, entry: null };
    expect(observe(nextClose, 21).ready).toBe(false);
    expect(observe(observe(nextClose, 21).state, 35).ready).toBe(true);
  });
});
