// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportTeamPresence: vi.fn(async (_teams: readonly string[]) => ({ success: true as const, error: null, data: { reported_count: 1 } })),
}));
vi.mock("./teamSharingService", () => ({ reportTeamPresence: mocks.reportTeamPresence }));

import { TEAM_PRESENCE_REPORT_MS, useTeamPresenceReport, type UseTeamPresenceReportInput } from "./useTeamPresenceReport";

const base: UseTeamPresenceReportInput = { enabled: true, accountKey: "u1", teamsInHours: ["org-1"], recording: true };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  window.localStorage.clear();
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
});
