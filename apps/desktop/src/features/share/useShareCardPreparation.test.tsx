// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useShareCardPreparation } from "./useShareCardPreparation";
import { useShareCardLiveRanks } from "./useShareCardLiveRanks";
import { invalidateShareCardRanks, setShareCardRankAccountScope } from "./shareCardRankCache";
const mocks = vi.hoisted(() => ({ models: vi.fn(async () => ({ daily: null, weekly: null })), ranks: vi.fn() }));
vi.mock("../companion/communityFocusPercentileModelService", () => ({ loadCommunityFocusPercentileModels: mocks.models }));
vi.mock("../leaderboard/leaderboardService", () => ({ fetchOwnLeaderboardEntry: mocks.ranks }));
beforeEach(() => { setShareCardRankAccountScope(null); invalidateShareCardRanks(); mocks.ranks.mockReset().mockResolvedValue({ success: true, data: null }); mocks.models.mockClear(); });
afterEach(() => { cleanup(); setShareCardRankAccountScope(null); });

it("prepares when available, reuses ranks on focus/open, and starts the first render ready", async () => {
  const { result, rerender } = renderHook(({ enabled }) => useShareCardPreparation(enabled, "a", "day"), { initialProps: { enabled: false } });
  expect(mocks.ranks).not.toHaveBeenCalled(); expect(mocks.models).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await waitFor(() => expect(mocks.ranks).toHaveBeenCalledTimes(2));
  await act(async () => { result.current(); });
  const sheet = renderHook(() => useShareCardLiveRanks(true, "a", "day"));
  expect(sheet.result.current.state.daily.availability).toBe("not_joined");
  expect(sheet.result.current.state.weekly.availability).toBe("not_joined");
  await act(async () => {});
  expect(mocks.ranks).toHaveBeenCalledTimes(2);
});

it("lets the daily card finish while weekly is pending and retains its snapshot after expiry", async () => {
  let finishWeek!: (value: unknown) => void;
  mocks.ranks.mockImplementation((period: string) => period === "daily" ? Promise.resolve({ success: true, data: null }) : new Promise(r => { finishWeek = r; }));
  const sheet = renderHook(() => useShareCardLiveRanks(true, "a", "day"));
  await waitFor(() => expect(sheet.result.current.state.daily.availability).toBe("not_joined"));
  expect(sheet.result.current.state.weekly.availability).toBe("loading");
  await act(async () => { finishWeek({ success: true, data: null }); });
  const before = sheet.result.current.state;
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  sheet.rerender(); expect(sheet.result.current.state).toBe(before);
  vi.restoreAllMocks();
});

it("does not request own ranks when signed out and guards the first account-switch render", async () => {
  renderHook(() => useShareCardPreparation(true, null, "day"));
  expect(mocks.ranks).not.toHaveBeenCalled();
  const sheet = renderHook(({ scope }) => useShareCardLiveRanks(true, scope, "day"), { initialProps: { scope: "a" as string | null } });
  await waitFor(() => expect(sheet.result.current.state.daily.availability).toBe("not_joined"));
  mocks.ranks.mockImplementation(() => new Promise(() => {}));
  sheet.rerender({ scope: "b" });
  expect(sheet.result.current.state.daily.availability).toBe("loading");
  sheet.rerender({ scope: null });
  expect(sheet.result.current.state.daily.availability).toBe("not_joined");
});

it("does not let pre-join requests overwrite a refreshed rank or refresh after unmount", async () => {
  let finishOldWeek!: (value: unknown) => void;
  let firstWeek = true;
  const joined = { success: true, data: { opted_in: true, rank: 22, participant_count: 400, window_start_date: "day", window_end_date: "day" } };
  mocks.ranks.mockImplementation((period: string) => {
    if (period === "weekly" && firstWeek) { firstWeek = false; return new Promise(r => { finishOldWeek = r; }); }
    return Promise.resolve(joined);
  });
  const sheet = renderHook(() => useShareCardLiveRanks(true, "a", "day"));
  await waitFor(() => expect(sheet.result.current.state.daily.availability).toBe("ready"));
  await act(async () => { await sheet.result.current.refresh(); });
  expect(sheet.result.current.state.weekly.rank?.rank).toBe(22);
  await act(async () => { finishOldWeek({ success: true, data: null }); });
  expect(sheet.result.current.state.weekly.rank?.rank).toBe(22);
  const refresh = sheet.result.current.refresh; const calls = mocks.ranks.mock.calls.length;
  sheet.unmount(); await refresh();
  expect(mocks.ranks).toHaveBeenCalledTimes(calls);
});
