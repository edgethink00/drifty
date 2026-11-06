// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTeamProjects } from "./useTeamProjects";
import { notifyTeamTimeShared, subscribeTeamProjectMirrorChanged } from "../../lib/teamProjectMirrorEvents";
const mocks = vi.hoisted(() => ({
  projects: vi.fn(), mix: vi.fn(), members: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), publish: vi.fn(), stop: vi.fn(),
  mirror: vi.fn(), timeline: vi.fn(),
  membership: vi.fn(), focus: vi.fn(), focusDays: vi.fn(), totals: vi.fn(), work: vi.fn(),
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
vi.mock("./teamProjectTime", () => ({ aggregateTeamProjectDayTotals: () => [{ project_id: "project-a", activity_date: "2026-10-04", seconds: 60 }] }));
vi.mock("./teamSharingService", () => ({ fetchTeamMembershipStart: mocks.membership, publishTeamFocusDays: mocks.focus, fetchTeamTotals: mocks.totals, fetchTeamWorkBlocks: mocks.work }));
vi.mock("./teamFocusPublish", () => ({ teamFocusDayTotals: mocks.focusDays }));
const input = { enabled: true, memberDisplayName: "Member", userEmail: "owner@example.test", startOfDayMinutes: 240, currentDay: "2026-10-04" };
const project = { id: "project-a", organization_id: "team-a", name: "Private A", description: "", color: "#123456", status: "active", anchors: [] };
const ok = (data: unknown) => ({ success: true, data });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.membership.mockResolvedValue(ok("2026-10-01T00:00:00Z"));
  mocks.projects.mockResolvedValue(ok([project])); mocks.mix.mockResolvedValue(ok([{ seconds: 60 }])); mocks.members.mockResolvedValue(ok([{ display_name: "A" }]));
  mocks.mirror.mockResolvedValue(undefined); mocks.timeline.mockResolvedValue([]);
  for (const fn of [mocks.create, mocks.update, mocks.archive, mocks.publish, mocks.stop]) fn.mockResolvedValue(ok({}));
  mocks.focus.mockResolvedValue(ok({ published_row_count: 1 }));
  mocks.focusDays.mockReturnValue([{ activity_date: "2026-10-04", seconds: 1800 }]);
  mocks.totals.mockResolvedValue(ok([{ row_kind: "member_project", member_key: "k-a", activity_date: "2026-10-04", seconds: 60 }]));
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

it("keeps a confirmed empty result during a refresh and resets readiness for a different window", async () => {
  mocks.projects.mockResolvedValue(ok([]));
  mocks.mix.mockResolvedValue(ok([]));
  mocks.members.mockResolvedValue(ok([]));
  const { result, rerender } = renderHook(({ offset }) => useTeamProjects({
    ...input, organizationId: "team-a", windowOffset: offset,
  }), { initialProps: { offset: 0 } });
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  expect(result.current.mix).toEqual([]);

  const oldRefresh = deferred<ReturnType<typeof ok>>();
  mocks.projects.mockReturnValueOnce(oldRefresh.promise);
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.refresh(); });
  expect(result.current).toMatchObject({ loading: true, hasLoaded: true, mix: [] });

  const nextWindow = deferred<ReturnType<typeof ok>>();
  mocks.projects.mockReturnValueOnce(nextWindow.promise);
  rerender({ offset: 1 });
  await act(async () => { oldRefresh.resolve(ok([project])); await refresh; });
  expect(result.current).toMatchObject({ loading: true, hasLoaded: false, projects: [] });
  await act(async () => { nextWindow.resolve(ok([])); });
  expect(result.current).toMatchObject({ loading: false, hasLoaded: true, projects: [] });
});

it("requires the current team's totals to succeed before presenting an empty result", async () => {
  mocks.totals.mockResolvedValueOnce({ success: false, error: "Totals unavailable" });
  const { result } = renderHook(() => useTeamProjects({
    ...input, organizationId: "team-a", sharing: { projects: true, focus: true },
  }));
  await waitFor(() => expect(result.current.error).toBe("Totals unavailable"));
  expect(result.current.hasLoaded).toBe(false);
  await act(async () => { await result.current.refresh(); });
  expect(result.current.hasLoaded).toBe(true);
  expect(result.current.error).toBeNull();
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

it("reports the shared time and project count after a share", async () => {
  const { result } = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a" }));
  await loaded(result);
  await act(async () => { await result.current.publishMyTime(); });
  expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({
    organization_id: "team-a",
    entries: [{ project_id: "project-a", activity_date: "2026-10-04", seconds: 60 }],
  }));
  expect(result.current.publishNote).toBe("Shared 1m across 1 project for this window.");
  // A server that predates stored sharing never receives focus.
  expect(mocks.focus).not.toHaveBeenCalled();
  expect(mocks.totals).not.toHaveBeenCalled();
  expect(result.current.totals).toBeNull();
});

it("sends focus only while the team shares it, and project time only while it shares that", async () => {
  const classification = { includeAiClassifications: true };
  const { result, rerender } = renderHook(({ sharing }) => useTeamProjects({ ...input, organizationId: "team-a", sharing, focusClassification: classification }), {
    initialProps: { sharing: { projects: false, focus: true } },
  });
  await loaded(result);
  // A server that stores sharing also returns the seat's figures by day.
  expect(result.current.totals).toEqual([{ row_kind: "member_project", member_key: "k-a", activity_date: "2026-10-04", seconds: 60 }]);
  await act(async () => { await result.current.publishMyTime(); });
  expect(mocks.focusDays).toHaveBeenCalledWith([], expect.anything(), classification, 240, expect.anything());
  expect(mocks.focus).toHaveBeenCalledWith(expect.objectContaining({ organization_id: "team-a", entries: [{ activity_date: "2026-10-04", seconds: 1800 }] }));
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(result.current.publishNote).toBe("Shared 30m of focus for this window.");

  mocks.focus.mockClear();
  rerender({ sharing: { projects: true, focus: false } });
  await loaded(result);
  await act(async () => { await result.current.publishMyTime(); });
  expect(mocks.focus).not.toHaveBeenCalled();
  expect(mocks.publish).toHaveBeenCalledTimes(1);
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

it("announces a mirrored project set so project analysis can count it", async () => {
  const announced = vi.fn();
  const unsubscribe = subscribeTeamProjectMirrorChanged(announced);
  const { result } = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a" }));
  await loaded(result);
  await waitFor(() => expect(mocks.mirror).toHaveBeenCalledWith("team-a", expect.any(Array)));
  await waitFor(() => expect(announced).toHaveBeenCalled());
  unsubscribe();
});

it("does not read or upload local history when its own join time cannot be verified", async () => {
  mocks.membership.mockResolvedValue({ success: false, error: "Offline" });
  const { result } = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a" }));
  await loaded(result); await act(async () => { await result.current.publishMyTime(); });
  expect(mocks.timeline).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.focus).not.toHaveBeenCalled();
  expect(result.current.actionError).toBe("Offline");
});

it("reads the team's totals again once automatic sharing has sent this person's time", async () => {
  const { result } = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a" }));
  await loaded(result);
  const before = mocks.projects.mock.calls.length;
  act(() => { notifyTeamTimeShared("team-b"); });
  expect(mocks.projects.mock.calls.length).toBe(before);
  act(() => { notifyTeamTimeShared("team-a"); });
  await waitFor(() => expect(mocks.projects.mock.calls.length).toBe(before + 1));
});

it("reads work blocks only where the team shares names or time of day, and keeps the page when the server lacks them", async () => {
  const blocks = [{ member_key: "k-a", member_display_name: "A", is_self: false, activity_date: "2026-10-04", started_at: null, ended_at: null, seconds: 600, organization_project_id: null, title: "Notes", is_focus: null }];
  mocks.work.mockResolvedValue(ok(blocks));
  const plain = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a", sharing: { projects: true, focus: false } }));
  await loaded(plain.result);
  expect(mocks.work).not.toHaveBeenCalled();
  expect(plain.result.current.workBlocks).toEqual([]);
  plain.unmount();

  const work = renderHook(() => useTeamProjects({ ...input, organizationId: "team-a", sharing: { projects: true, focus: false, work: true } }));
  await loaded(work.result);
  expect(work.result.current.workBlocks).toEqual(blocks);
  mocks.work.mockResolvedValue({ success: false, error: "Could not find the function", reason: "remote_error" });
  await act(async () => { await work.result.current.refresh(); });
  expect(work.result.current.workBlocks).toEqual([]);
  expect(work.result.current.error).toBeNull();
});
