// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ teams: vi.fn(), policy: vi.fn(), exclusion: vi.fn() }));
vi.mock("./teamService", () => ({ fetchOwnTeams: mocks.teams }));
vi.mock("./teamSharingService", () => ({ fetchTeamServerPolicy: mocks.policy }));
vi.mock("./teamGroupsService", () => ({ fetchTeamBlockExclusion: mocks.exclusion }));

import { readTeamExcludedRanges, setTeamBlocksExcluded } from "./teamBlockExclusions";
import { useTeamExclusionOffered } from "./useTeamExclusionOffered";

const ok = <T,>(data: T) => ({ success: true as const, data });
const team = (id: string) => ({ organization_id: id });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.teams.mockResolvedValue(ok([]));
  mocks.policy.mockResolvedValue(ok({ policy: {} }));
  mocks.exclusion.mockResolvedValue(ok(true));
});

describe("team block exclusion availability", () => {
  it("hides while loading, without a team, and on a failed membership read", async () => {
    let resolve!: (value: unknown) => void;
    mocks.teams.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result, rerender } = renderHook(({ key }) => useTeamExclusionOffered(true, "u", key), { initialProps: { key: "initial" } });
    expect(result.current).toBe(false);
    await act(async () => resolve(ok([])));
    expect(result.current).toBe(false);
    mocks.teams.mockResolvedValueOnce({ success: false });
    rerender({ key: "retry" });
    await waitFor(() => expect(mocks.teams).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(false);
  });

  it("shows only when a current team with automatic sharing permits exclusion", async () => {
    mocks.teams.mockResolvedValue(ok([team("a"), team("b")]));
    mocks.exclusion.mockImplementation(async ({ organization_id }: { organization_id: string }) => ok(organization_id === "b"));
    const { result, rerender } = renderHook(({ key }) => useTeamExclusionOffered(true, "u", key), { initialProps: { key: "mixed" } });
    await waitFor(() => expect(result.current).toBe(true));
    mocks.exclusion.mockResolvedValue(ok(false));
    rerender({ key: "disallowed" });
    expect(result.current).toBe(false);
    await waitFor(() => expect(mocks.exclusion).toHaveBeenCalledTimes(4));
    expect(result.current).toBe(false);
    mocks.policy.mockResolvedValue(ok({ policy: null }));
    mocks.exclusion.mockResolvedValue(ok(true));
    rerender({ key: "legacy" });
    await waitFor(() => expect(mocks.policy).toHaveBeenCalledTimes(6));
    expect(result.current).toBe(false);
  });

  it("hides on leave, ignores an old read, and preserves the choice after rejoining", async () => {
    const now = Date.now();
    const block = { start: now - 1000, end: now };
    setTeamBlocksExcluded([block], true, now);
    let resolve!: (value: unknown) => void;
    mocks.teams.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result, rerender } = renderHook(({ key }) => useTeamExclusionOffered(true, "u", key), { initialProps: { key: "old" } });
    rerender({ key: "left" });
    await act(async () => resolve(ok([team("a")])));
    expect(result.current).toBe(false);
    expect(readTeamExcludedRanges()).toEqual([block]);
    mocks.teams.mockResolvedValue(ok([team("a")]));
    rerender({ key: "rejoined" });
    await waitFor(() => expect(result.current).toBe(true));
    expect(readTeamExcludedRanges()).toEqual([block]);
    rerender({ key: "left-again" });
  });

  it("hides on sign-out and when the exclusion policy cannot be read", async () => {
    mocks.teams.mockResolvedValue(ok([team("a")]));
    const { result, rerender } = renderHook(({ account }) => useTeamExclusionOffered(true, account, "team"), { initialProps: { account: "u" as string | null } });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ account: null });
    expect(result.current).toBe(false);
    mocks.exclusion.mockResolvedValue({ success: false });
    rerender({ account: "other" });
    await waitFor(() => expect(mocks.exclusion).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(false);
  });

  it("refreshes when the local team policy changes", async () => {
    mocks.teams.mockResolvedValue(ok([team("a")]));
    const { result } = renderHook(() => useTeamExclusionOffered(true, "u", "team"));
    await waitFor(() => expect(result.current).toBe(true));
    mocks.exclusion.mockResolvedValue(ok(false));
    act(() => window.dispatchEvent(new Event("drifty:team-exclusion-policy-changed")));
    expect(result.current).toBe(false);
    await waitFor(() => expect(mocks.exclusion).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(false);
  });
});
