// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setTeamPauseLock: vi.fn(async () => undefined),
  fetchOwnTeams: vi.fn(),
  fetchTeamServerPolicy: vi.fn(),
}));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: { setTeamPauseLock: mocks.setTeamPauseLock } }));
vi.mock("./teamService", () => ({ fetchOwnTeams: mocks.fetchOwnTeams }));
vi.mock("./teamSharingService", () => ({ fetchTeamServerPolicy: mocks.fetchTeamServerPolicy }));

import { useTeamPauseLock } from "./useTeamPauseLock";

const team = { organization_id: "org-1", organization_name: "Sales", membership_role: "member", tracking_policy: "free", recording_schedule: null };
const policy = { tracking_policy: "managed", seat: "member", schedule: { days: [1, 2, 3, 4, 5, 6, 7], start_minute: 0, end_minute: 1440, timezone: "local" } };

beforeEach(() => {
  window.localStorage.clear();
  mocks.setTeamPauseLock.mockClear();
  mocks.fetchOwnTeams.mockResolvedValue({ success: true, error: null, data: [team] });
  mocks.fetchTeamServerPolicy.mockResolvedValue({ success: true, error: null, data: policy });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("useTeamPauseLock", () => {
  it("uses the current clock as soon as a delayed team read finishes", async () => {
    const today = new Date();
    const beforeHours = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9).getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(beforeHours);
    let finishRead!: (value: unknown) => void;
    mocks.fetchOwnTeams.mockReturnValue(new Promise((resolve) => { finishRead = resolve; }));
    mocks.fetchTeamServerPolicy.mockResolvedValue({ success: true, error: null, data: {
      ...policy, schedule: { ...policy.schedule, start_minute: 9 * 60 + 1, end_minute: 10 * 60 },
    } });
    const { result } = renderHook(() => useTeamPauseLock({ enabled: true, accountKey: "u1", teamsKey: "" }));
    expect(result.current.lock).toBeNull();

    clock.mockReturnValue(beforeHours + 2 * 60_000);
    finishRead({ success: true, error: null, data: [team] });
    await waitFor(() => expect(mocks.setTeamPauseLock).toHaveBeenCalled());
    expect(result.current.lock?.teamName).toBe("Sales");
    expect(result.current.teamsInHours).toEqual(["org-1"]);
  });

  it("lifts a lock this device set once outside the Teams beta, and sends nothing when there was none", async () => {
    const quiet = renderHook(() => useTeamPauseLock({ enabled: false, accountKey: "u1", teamsKey: "" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.setTeamPauseLock).not.toHaveBeenCalled();
    expect(quiet.result.current).toEqual({ lock: null, teamsInHours: [] });
    quiet.unmount();

    window.localStorage.setItem("drifty.team.pauseLockSent", "1");
    renderHook(() => useTeamPauseLock({ enabled: false, accountKey: "u1", teamsKey: "" }));
    await waitFor(() => expect(mocks.setTeamPauseLock).toHaveBeenCalledWith([]));
    await waitFor(() => expect(window.localStorage.getItem("drifty.team.pauseLockSent")).toBeNull());
    expect(mocks.fetchOwnTeams).not.toHaveBeenCalled();
  });

  it("sends a managed team's hours to the native side and reports the lock in force with the teams in hours", async () => {
    const { result } = renderHook(() => useTeamPauseLock({ enabled: true, accountKey: "u1", teamsKey: "" }));
    await waitFor(() => expect(result.current.lock?.teamName).toBe("Sales"));
    expect(result.current.teamsInHours).toEqual(["org-1"]);
    const calls = mocks.setTeamPauseLock.mock.calls as unknown as [readonly Record<string, unknown>[]][];
    const sent = calls[calls.length - 1]![0];
    expect(sent.length).toBeGreaterThan(0);
    // The native side gets the name and the times only.
    expect(sent.every((span) => span.teamName === "Sales" && Object.keys(span).sort().join(",") === "endsAt,startsAt,teamName")).toBe(true);
    expect(window.localStorage.getItem("drifty.team.pauseLockSent")).toBe("1");
  });

  it("leaves leaders free and keeps the last lock when the teams cannot be read", async () => {
    window.localStorage.setItem("drifty.team.pauseLockSent", "1");
    mocks.fetchTeamServerPolicy.mockResolvedValue({ success: true, error: null, data: { ...policy, seat: "manager" } });
    const { result, rerender } = renderHook((props: { teamsKey: string }) => useTeamPauseLock({ enabled: true, accountKey: "u1", teamsKey: props.teamsKey }), { initialProps: { teamsKey: "a" } });
    await waitFor(() => expect(mocks.setTeamPauseLock).toHaveBeenCalledWith([]));
    expect(result.current).toEqual({ lock: null, teamsInHours: [] });

    mocks.setTeamPauseLock.mockClear();
    mocks.fetchOwnTeams.mockResolvedValue({ success: false, error: "offline", reason: "network" });
    rerender({ teamsKey: "b" });
    await waitFor(() => expect(mocks.fetchOwnTeams).toHaveBeenCalledTimes(2));
    expect(mocks.setTeamPauseLock).not.toHaveBeenCalled();
  });
});

