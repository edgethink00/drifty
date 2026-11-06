// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchOwnTeams: vi.fn(), fetchTeamProjects: vi.fn(), fetchTeamServerPolicy: vi.fn(),
  upsertTeamProjects: vi.fn(), shareOwnTeamTime: vi.fn(),
}));
vi.mock("./teamService", () => ({ fetchOwnTeams: mocks.fetchOwnTeams, fetchTeamProjects: mocks.fetchTeamProjects }));
vi.mock("./teamSharingService", () => ({ fetchTeamServerPolicy: mocks.fetchTeamServerPolicy }));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: { upsertTeamProjects: mocks.upsertTeamProjects } }));
vi.mock("./teamAutoShare", () => ({ shareOwnTeamTime: mocks.shareOwnTeamTime }));
vi.mock("./useTeamProjects", () => ({ toLocalTeamProjectInputs: (projects: { id: string }[]) => projects.map((project) => ({ id: project.id })) }));

import { subscribeTeamTimeShared } from "../../lib/teamProjectMirrorEvents";
import { TEAM_AUTO_SHARE_FIRST_DELAY_MS, TEAM_AUTO_SHARE_INTERVAL_MS, shareToTeamsOnce, useTeamAutoShare, type UseTeamAutoShareInput } from "./useTeamAutoShare";

const ok = <T>(data: T) => ({ success: true as const, error: null, data });
const team = (id: string) => ({ organization_id: id, organization_name: id, member_display_name: " Alex ", membership_role: "owner" });
const policy = { projects: "hourly", tasks: "off", focus: "off", memberSummary: true };
const schedule = { days: [1, 2, 3, 4, 5], start_minute: 540, end_minute: 1080, timezone: "Asia/Seoul", clock: "team" };
const base: UseTeamAutoShareInput = { enabled: true, accountKey: "u1", teamsKey: "", startOfDayMinutes: 0, focusClassification: { includeAiClassifications: true } };
const settle = async () => { for (let step = 0; step < 20; step += 1) await Promise.resolve(); };

beforeEach(() => {
  mocks.fetchOwnTeams.mockResolvedValue(ok([team("with-policy"), team("legacy")]));
  mocks.fetchTeamServerPolicy.mockImplementation(async ({ organization_id }: { organization_id: string }) => ok({
    organization_id, policy: organization_id === "legacy" ? null : policy, schedule: organization_id === "legacy" ? null : schedule,
  }));
  mocks.fetchTeamProjects.mockResolvedValue(ok([{ id: "project-a" }]));
  mocks.upsertTeamProjects.mockResolvedValue([]);
  mocks.shareOwnTeamTime.mockResolvedValue({ status: "shared", projectDays: 1, focusDays: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("shareToTeamsOnce", () => {
  it("shares only with teams that store their sharing, after copying their projects to this computer", async () => {
    const shared: string[] = [];
    const stop = subscribeTeamTimeShared((id) => shared.push(id));
    const outcomes = await shareToTeamsOnce({ startOfDayMinutes: 240, focusClassification: null });
    stop();
    expect(mocks.shareOwnTeamTime).toHaveBeenCalledTimes(1);
    expect(mocks.shareOwnTeamTime).toHaveBeenCalledWith(
      { organizationId: "with-policy", displayName: "Alex", policy, schedule },
      { startOfDayMinutes: 240, focusClassification: null },
    );
    expect(mocks.upsertTeamProjects).toHaveBeenCalledWith("with-policy", [{ id: "project-a" }]);
    expect([...outcomes.keys()]).toEqual(["with-policy"]);
    expect(shared).toEqual(["with-policy"]);
  });

  it("keeps the local copy when the team's projects read empty, and tells no page when nothing went up", async () => {
    mocks.fetchTeamProjects.mockResolvedValue(ok([]));
    mocks.shareOwnTeamTime.mockResolvedValue({ status: "nothing" });
    const shared: string[] = [];
    const stop = subscribeTeamTimeShared((id) => shared.push(id));
    await shareToTeamsOnce({ startOfDayMinutes: 0, focusClassification: null });
    stop();
    expect(mocks.upsertTeamProjects).not.toHaveBeenCalled();
    expect(shared).toEqual([]);
  });

  it("goes on to the next team when one fails", async () => {
    mocks.fetchOwnTeams.mockResolvedValue(ok([team("a"), team("b")]));
    mocks.shareOwnTeamTime.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: "nothing" });
    const outcomes = await shareToTeamsOnce({ startOfDayMinutes: 0, focusClassification: null });
    expect(outcomes.get("a")).toEqual({ status: "failed", error: "offline" });
    expect(outcomes.get("b")).toEqual({ status: "nothing" });
  });
});

describe("useTeamAutoShare", () => {
  it("shares shortly after the app opens and every half hour", async () => {
    vi.useFakeTimers();
    renderHook(() => useTeamAutoShare(base));
    expect(mocks.fetchOwnTeams).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(TEAM_AUTO_SHARE_FIRST_DELAY_MS); await settle(); });
    expect(mocks.shareOwnTeamTime).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(TEAM_AUTO_SHARE_INTERVAL_MS); await settle(); });
    expect(mocks.shareOwnTeamTime).toHaveBeenCalledTimes(2);
  });

  it("sends nothing outside the Teams beta or while signed out", async () => {
    vi.useFakeTimers();
    renderHook(() => useTeamAutoShare({ ...base, enabled: false }));
    renderHook(() => useTeamAutoShare({ ...base, accountKey: null }));
    await act(async () => { vi.advanceTimersByTime(TEAM_AUTO_SHARE_INTERVAL_MS * 2); await settle(); });
    expect(mocks.fetchOwnTeams).not.toHaveBeenCalled();
  });

  it("starts again when the teams change and stops when the hook goes away", async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook((props: UseTeamAutoShareInput) => useTeamAutoShare(props), { initialProps: base });
    rerender({ ...base, teamsKey: "joined" });
    await act(async () => { vi.advanceTimersByTime(TEAM_AUTO_SHARE_FIRST_DELAY_MS); await settle(); });
    expect(mocks.fetchOwnTeams).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { vi.advanceTimersByTime(TEAM_AUTO_SHARE_INTERVAL_MS); await settle(); });
    expect(mocks.fetchOwnTeams).toHaveBeenCalledTimes(1);
  });
});
