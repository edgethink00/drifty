// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportTeamPresence: vi.fn(async (_teams: readonly string[]) => ({ success: true as const, error: null, data: { reported_count: 1 } })),
}));
vi.mock("./teamSharingService", () => ({ reportTeamPresence: mocks.reportTeamPresence }));

import { normalizeCapturePolicy, recordingSchedulePayload, resetCapturePolicyForTests, updateCapturePolicy } from "../feedback-requests/capturePolicy";
import { recordingAllowedAt } from "../feedback-requests/recordingSchedule";
import { TEAM_PRESENCE_REPORT_MS, useTeamPresenceReport, type UseTeamPresenceReportInput } from "./useTeamPresenceReport";

const base: UseTeamPresenceReportInput = { enabled: true, accountKey: "u1", teamsInHours: ["org-1"], recording: true };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Execute App's actual recording input, without mounting its unrelated effects
// or copying that expression into this cross-feature test. Resolve its local
// boolean when the call uses one, so the original wiring also runs (and fails).
const app = ts.createSourceFile("App.tsx", readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let recordingExpression: ts.Expression | undefined;
const initializers = new Map<string, ts.Expression>();
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) initializers.set(node.name.text, node.initializer);
  if (ts.isCallExpression(node) && node.expression.getText(app) === "useTeamPresenceReport") {
    const input = node.arguments[0];
    if (input && ts.isObjectLiteralExpression(input)) {
      const property = input.properties.find((entry) => ts.isPropertyAssignment(entry) && entry.name.getText(app) === "recording");
      if (property && ts.isPropertyAssignment(property)) recordingExpression = property.initializer;
    }
  }
  ts.forEachChild(node, visit);
}
visit(app);
if (!recordingExpression) throw new Error("App must pass its recording state to useTeamPresenceReport");
const expression = ts.isIdentifier(recordingExpression) ? initializers.get(recordingExpression.text) : recordingExpression;
if (!expression) throw new Error("App recording state must have a local initializer");
const appRecording = new Function("status", "recordingHoursPause", `return (${expression.getText(app)});`) as (
  status: { running: boolean; trackingPaused: boolean }, pause: { paused: boolean },
) => boolean;

beforeEach(() => {
  window.localStorage.clear();
  resetCapturePolicyForTests();
  mocks.reportTeamPresence.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("useTeamPresenceReport", () => {
  it("reports the teams in hours while this computer records, every few minutes", () => {
    vi.useFakeTimers();
    renderHook(() => useTeamPresenceReport(base));
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(1);
    expect(mocks.reportTeamPresence).toHaveBeenLastCalledWith(["org-1"]);
    vi.advanceTimersByTime(TEAM_PRESENCE_REPORT_MS);
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(2);
    expect(TEAM_PRESENCE_REPORT_MS).toBeLessThan(10 * 60 * 1000);
  });

  it("sends nothing when recording stops, so another of the person's computers may keep the status", () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((props: UseTeamPresenceReportInput) => useTeamPresenceReport(props), { initialProps: base });
    rerender({ ...base, recording: false });
    vi.advanceTimersByTime(TEAM_PRESENCE_REPORT_MS * 2);
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(1);
  });

  it("clears the status it left once the hours end, and sends nothing when it never reported", async () => {
    const quiet = renderHook(() => useTeamPresenceReport({ ...base, teamsInHours: [] }));
    await flush();
    expect(mocks.reportTeamPresence).not.toHaveBeenCalled();
    quiet.unmount();

    const { rerender } = renderHook((props: UseTeamPresenceReportInput) => useTeamPresenceReport(props), { initialProps: base });
    expect(window.localStorage.getItem("drifty.team.presenceReported")).toBe("1");
    rerender({ ...base, teamsInHours: [] });
    await flush();
    expect(mocks.reportTeamPresence).toHaveBeenLastCalledWith([]);
    expect(window.localStorage.getItem("drifty.team.presenceReported")).toBeNull();
  });

  it("clears it when the Teams beta closes, and stays quiet while signed out", async () => {
    window.localStorage.setItem("drifty.team.presenceReported", "1");
    const signedOut = renderHook(() => useTeamPresenceReport({ ...base, accountKey: null }));
    await flush();
    expect(mocks.reportTeamPresence).not.toHaveBeenCalled();
    signedOut.unmount();
    renderHook(() => useTeamPresenceReport({ ...base, enabled: false }));
    await flush();
    expect(mocks.reportTeamPresence).toHaveBeenCalledWith([]);
  });

  it.each([
    { name: "hours OFF", enabled: false, hour: 11, running: true, trackingPaused: false, reports: 1 },
    { name: "hours ON, inside", enabled: true, hour: 9, running: true, trackingPaused: false, reports: 1 },
    { name: "hours ON, outside", enabled: true, hour: 11, running: true, trackingPaused: false, reports: 0 },
    { name: "paused with a still-running daemon", enabled: false, hour: 9, running: true, trackingPaused: true, reports: 0 },
    { name: "stopped", enabled: false, hour: 9, running: false, trackingPaused: false, reports: 0 },
  ])("uses App's recording input with personal policy: $name", ({ enabled, hour, running, trackingPaused, reports }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, hour, 0)); // Monday, local clock
    const policy = normalizeCapturePolicy({ recordingHours: { enabled, days: [1], startMinute: 540, endMinute: 600 } });
    updateCapturePolicy(policy);
    const paused = !recordingAllowedAt(recordingSchedulePayload(policy), new Date());
    const recording = appRecording({ running, trackingPaused }, { paused });
    // Assert App's gate itself, so the hook's clock check cannot mask an omission.
    expect(recording).toBe(reports > 0);
    renderHook(() => useTeamPresenceReport({ ...base, recording }));
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(reports);
    if (reports) expect(mocks.reportTeamPresence).toHaveBeenCalledWith(["org-1"]);
    vi.advanceTimersByTime(TEAM_PRESENCE_REPORT_MS);
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(reports * 2);
  });

  it("checks the clock at each report even before App refreshes its hours state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 9, 59));
    updateCapturePolicy({ recordingHours: { enabled: true, days: [1], startMinute: 540, endMinute: 600 } });
    renderHook(() => useTeamPresenceReport(base));
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TEAM_PRESENCE_REPORT_MS * 2);
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(1);
    // No clearing: another computer may still record; this report goes stale.
    expect(window.localStorage.getItem("drifty.team.presenceReported")).toBe("1");
  });

  it("applies personal hours changes without clearing another computer's presence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 11));
    renderHook(() => useTeamPresenceReport(base));
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(1);
    act(() => updateCapturePolicy({ recordingHours: { enabled: true, days: [1], startMinute: 540, endMinute: 600 } }));
    vi.advanceTimersByTime(TEAM_PRESENCE_REPORT_MS);
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(1);
    act(() => updateCapturePolicy({ recordingHours: { enabled: false, days: [1], startMinute: 540, endMinute: 600 } }));
    expect(mocks.reportTeamPresence).toHaveBeenCalledTimes(2);
    expect(mocks.reportTeamPresence.mock.calls.every(([teams]) => teams.length > 0)).toBe(true);
  });

  it.each(["skip", "record"] as const)("reports only team ids, independent of the private-window preference %s", (privateWindows) => {
    updateCapturePolicy({ privateWindows });
    renderHook(() => useTeamPresenceReport(base));
    expect(mocks.reportTeamPresence.mock.calls).toEqual([[["org-1"]]]);
  });
});
