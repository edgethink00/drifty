// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTeamProjects } from "./useTeamProjects";
const mocks = vi.hoisted(() => ({
  projects: vi.fn(), mix: vi.fn(), members: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), publish: vi.fn(), stop: vi.fn(),
  mirror: vi.fn(), timeline: vi.fn(),
}));
vi.mock("./teamService", () => ({
  fetchTeamProjects: mocks.projects, fetchTeamProjectMix: mocks.mix, fetchTeamProjectMemberBreakdown: mocks.members,
  createTeamProject: mocks.create, updateTeamProject: mocks.update, archiveTeamProject: mocks.archive,
  publishTeamProjectTotals: mocks.publish, stopTeamProjectSharing: mocks.stop,
  isTeamErrorMessage: () => false, messageFromTeamError: (error: Error) => error.message,
}));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: {
  upsertTeamProjects: mocks.mirror, getTimeline: mocks.timeline,
  getTeamProjectAssignments: vi.fn().mockResolvedValue([]), getProjectWindowAssignments: vi.fn().mockResolvedValue([]),
} }));
vi.mock("./teamProjectTime", () => ({ aggregateTeamProjectDayTotals: () => [{ organization_project_id: "project-a", activity_date: "2026-10-04", seconds: 60 }] }));
const input = { enabled: true, memberDisplayName: "Member", userEmail: "owner@example.test", startOfDayMinutes: 240, currentDay: "2026-10-04" };
const project = { id: "project-a", organization_id: "team-a", name: "Private A", description: "", color: "#123456", status: "active", anchors: [] };
const ok = (data: unknown) => ({ success: true, data });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.projects.mockResolvedValue(ok([project])); mocks.mix.mockResolvedValue(ok([{ seconds: 60 }])); mocks.members.mockResolvedValue(ok([{ display_name: "A" }]));
  mocks.mirror.mockResolvedValue(undefined); mocks.timeline.mockResolvedValue([]);
  for (const fn of [mocks.create, mocks.update, mocks.archive, mocks.publish, mocks.stop]) fn.mockResolvedValue(ok({}));
});
async function loaded(result: { current: ReturnType<typeof useTeamProjects> }) {
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.projects).toHaveLength(1);
}

it("hides the old team's data on the first render and after a new-team fetch fails", async () => {
  const renders: Array<{ org: string; projects: unknown; mix: unknown; members: unknown }> = [];
  const { result, rerender } = renderHook(({ org }) => {
    const state = useTeamProjects({ ...input, organizationId: org });
    renders.push({ org, projects: state.projects, mix: state.mix, members: state.members }); return state;
  }, { initialProps: { org: "team-a" } });
  await loaded(result);
  mocks.projects.mockResolvedValueOnce({ success: false, error: "Offline" });
  rerender({ org: "team-b" });
  expect(renders.find(row => row.org === "team-b")).toMatchObject({ projects: [], mix: [], members: [] });
  await waitFor(() => expect(result.current.error).toBe("Offline"));
  expect(result.current.projects).toEqual([]); expect(result.current.mix).toEqual([]); expect(result.current.members).toEqual([]);
});

it("hides old totals on the first render of a new period", async () => {
  const renders: Array<{ offset: number; mix: unknown }> = [];
  const { result, rerender } = renderHook(({ offset }) => {
    const state = useTeamProjects({ ...input, organizationId: "team-a", windowOffset: offset });
    renders.push({ offset, mix: state.mix }); return state;
  }, { initialProps: { offset: 0 } });
  await loaded(result);
  mocks.projects.mockResolvedValueOnce({ success: false, error: "Offline" });
  rerender({ offset: 1 });
  expect(renders.find(row => row.offset === 1)?.mix).toEqual([]);
  await waitFor(() => expect(result.current.error).toBe("Offline"));
  expect(result.current.mix).toEqual([]);
});

it("keeps cached same-team data on a failed same-scope refresh", async () => {
  const { result } = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a" }));
  await loaded(result);
  mocks.projects.mockResolvedValueOnce({ success: false, error: "Offline" });
  await act(async () => { await result.current.refresh(); });
  expect(result.current.projects).toEqual([project]); expect(result.current.error).toBe("Offline");
});

it("does not let an old team's completed action refresh over the new team", async () => {
  const action = deferred<{ success: boolean; data: unknown }>(); mocks.create.mockReturnValueOnce(action.promise);
  const { result, rerender } = renderHook(({ org }) => useTeamProjects({ ...input, organizationId: org }), { initialProps: { org: "team-a" } });
  await loaded(result);
  let task!: Promise<boolean>; act(() => { task = result.current.createProject({ name: "New", description: "", color: "#123456", anchors: [] }); });
  mocks.projects.mockResolvedValueOnce(ok([{ ...project, id: "project-b", organization_id: "team-b" }]));
  rerender({ org: "team-b" }); await waitFor(() => expect(result.current.projects[0]?.id).toBe("project-b"));
  const fetchCount = mocks.projects.mock.calls.length;
  await act(async () => { action.resolve(ok({})); expect(await task).toBe(false); });
  expect(mocks.projects).toHaveBeenCalledTimes(fetchCount);
  expect(result.current.projects[0]?.id).toBe("project-b");
});

it("cancels a share after local reads if its team changes", async () => {
  const timeline = deferred<unknown[]>(); mocks.timeline.mockReturnValueOnce(timeline.promise);
  const { result, rerender } = renderHook(({ org }) => useTeamProjects({ ...input, organizationId: org }), { initialProps: { org: "team-a" } });
  await loaded(result);
  let task!: Promise<void>; act(() => { task = result.current.publishMyTime(); });
  rerender({ org: "team-b" });
  await act(async () => { timeline.resolve([]); await task; });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(result.current.publishNote).toBeNull();
});

it("ignores a pending refresh after being disabled and clears loading", async () => {
  const pending = deferred<ReturnType<typeof ok>>(); mocks.projects.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(({ enabled }) => useTeamProjects({ ...input, organizationId: "team-a", enabled }), { initialProps: { enabled: true } });
  expect(result.current.loading).toBe(true);
  rerender({ enabled: false });
  expect(result.current.loading).toBe(false);
  await act(async () => { pending.resolve(ok([project])); });
  expect(result.current.projects).toEqual([]); expect(mocks.mirror).not.toHaveBeenCalled();
});

it.each(["mix", "members"] as const)("keeps cached same-scope %s when that auxiliary RPC fails", async field => {
  const { result } = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a" }));
  await loaded(result);
  const before = result.current[field];
  mocks[field].mockResolvedValueOnce({ success: false, error: "Offline" });
  await act(async () => { await result.current.refresh(); });
  expect(result.current[field]).toEqual(before);
  expect(result.current.error).toBe("Offline");
});

it("does not restore the previous team's cached mix when only the new-team mix read fails", async () => {
  const { result, rerender } = renderHook(({ org }) => useTeamProjects({ ...input, organizationId: org }), { initialProps: { org: "team-a" } });
  await loaded(result);
  mocks.projects.mockResolvedValueOnce(ok([{ ...project, id: "project-b", organization_id: "team-b" }]));
  mocks.mix.mockResolvedValueOnce({ success: false, error: "Offline" });
  mocks.members.mockResolvedValueOnce(ok([{ display_name: "B" }]));
  rerender({ org: "team-b" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.projects[0]?.id).toBe("project-b");
  expect(result.current.mix).toEqual([]);
  expect(result.current.members).toEqual([{ display_name: "B" }]);
  expect(result.current.error).toBe("Offline");
});
