// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentsBackfillDays,
  buildAgentsLoadingDays,
  buildAgentsRangeDays,
  shouldAwaitBackfill,
  useAgentsData,
} from "./useAgentsData";

const trackerClient = vi.hoisted(() => ({
  getDevRepos: vi.fn(),
  getDevSignals: vi.fn(),
  getTimeline: vi.fn(),
  syncDevSignals: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient }));

const emptySignals = {
  commits: [],
  agentTurns: [],
  agentSummary: {
    wallClockSeconds: 0,
    cumulativeSeconds: 0,
    concurrencyPeak: 0,
    parallelFactor: 0,
    spans: [],
  },
};

describe("Your Agents date ranges", () => {
  beforeEach(() => {
    trackerClient.getDevRepos.mockReset().mockResolvedValue([]);
    trackerClient.getDevSignals.mockReset().mockResolvedValue(emptySignals);
    trackerClient.getTimeline.mockReset().mockResolvedValue([]);
    trackerClient.syncDevSignals.mockReset().mockResolvedValue(null);
  });

  it("builds inclusive Day and Week request days", () => {
    expect(buildAgentsRangeDays("2026-08-28", "2026-08-28")).toEqual(["2026-08-28"]);
    expect(buildAgentsRangeDays("2026-08-24", "2026-08-30")).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("starts a requested range empty instead of rendering the sample fixture", () => {
    expect(buildAgentsLoadingDays(["2026-08-28", "2026-08-29"])).toEqual([
      { day: "2026-08-28", attention: [], turns: [], commits: [] },
      { day: "2026-08-29", attention: [], turns: [], commits: [] },
    ]);
  });

  it("expands ingestion only when an explicitly selected range predates the normal window", () => {
    expect(agentsBackfillDays("2026-08-28", "2026-08-28")).toBe(30);
    expect(agentsBackfillDays("2026-06-28", "2026-08-28")).toBe(62);
  });

  it("counts calendar days across a DST boundary instead of local clock hours", () => {
    // Seoul has no DST, so this pins the arithmetic itself: 2026-11-01 is the
    // US fall-back date, where a local-midnight subtraction gains an hour.
    expect(agentsBackfillDays("2026-10-25", "2026-11-08")).toBe(30);
    expect(agentsBackfillDays("2026-06-01", "2026-11-08")).toBe(161);
  });

  it("caps ingestion so navigating deep history cannot request an unbounded rescan", () => {
    expect(agentsBackfillDays("2020-01-01", "2026-08-28")).toBe(400);
  });

  it("blocks on ingestion only for a range that can still be changing", () => {
    // Today and the in-progress week: sessions and commits are still landing,
    // so the view waits for the refresh.
    expect(shouldAwaitBackfill("2026-08-28", "2026-08-28")).toBe(true);
    expect(shouldAwaitBackfill("2026-08-30", "2026-08-28")).toBe(true);
    // A settled past range is already stored; a 46s rescan must not gate it.
    expect(shouldAwaitBackfill("2026-08-27", "2026-08-28")).toBe(false);
    expect(shouldAwaitBackfill("2026-06-28", "2026-08-28")).toBe(false);
  });

  it("returns an empty loading range immediately when navigation changes the requested dates", async () => {
    trackerClient.getDevSignals
      .mockResolvedValueOnce(emptySignals)
      .mockReturnValueOnce(new Promise(() => undefined));

    const hook = renderHook(
      ({ startDay, endDay }) => useAgentsData(startDay, endDay),
      { initialProps: { startDay: "2026-08-28", endDay: "2026-08-28" } },
    );

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.days[0]?.day).toBe("2026-08-28");

    hook.rerender({ startDay: "2026-08-27", endDay: "2026-08-27" });

    expect(hook.result.current).toEqual({
      days: [{ day: "2026-08-27", attention: [], turns: [], commits: [] }],
      loading: true,
      live: false,
    });
  });

  it("queries and maps a day from the configured logical start", async () => {
    trackerClient.getDevSignals.mockResolvedValue({
      ...emptySignals,
      agentTurns: [{
        provider: "codex",
        sessionKey: "session-1",
        turnIndex: 0,
        startedAt: "2026-08-28T04:30:00",
        endedAt: "2026-08-28T05:30:00",
        activeSeconds: 3_600,
        cwdKey: null,
        model: "gpt-5",
        totalTokens: 100,
      }],
      commits: [{
        repoKey: "repo-1",
        commitSha: "abc123",
        authoredAt: "2026-08-29T03:30:00",
        insertions: 12,
        deletions: 3,
        filesChanged: 2,
      }],
    });
    trackerClient.getTimeline.mockResolvedValue([{
      startedAt: "2026-08-28T04:15:00",
      endedAt: "2026-08-28T04:45:00",
    }]);

    const hook = renderHook(() => useAgentsData("2026-08-28", "2026-08-28", 4 * 60));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    const logicalRange = {
      start: "2026-08-28T04:00:00",
      end: "2026-08-29T03:59:59",
    };
    expect(trackerClient.getDevSignals).toHaveBeenCalledWith(logicalRange);
    expect(trackerClient.getTimeline).toHaveBeenCalledWith(logicalRange);
    expect(hook.result.current.days[0]).toMatchObject({
      attention: [[15, 45]],
      turns: [[30, 90, "codex", "", "gpt-5", 100]],
      commits: [[1_410, 12, 3, 2, "abc123", "repo-1"]],
      sessions: 1,
      tokens: 100,
    });
  });

  it("reloads the current range after a manual SSH collection", async () => {
    const hook = renderHook(
      ({ refreshKey }) => useAgentsData("2026-08-28", "2026-08-28", 0, refreshKey),
      { initialProps: { refreshKey: 0 } },
    );

    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(trackerClient.syncDevSignals).toHaveBeenCalledTimes(1);

    hook.rerender({ refreshKey: 1 });

    await waitFor(() => expect(trackerClient.syncDevSignals).toHaveBeenCalledTimes(2));
  });

  it("labels remote SSH turns with the remote repository name", async () => {
    trackerClient.getDevRepos.mockResolvedValue([]);
    trackerClient.getDevSignals.mockResolvedValue({
      agentTurns: [{
        provider: "codex",
        sessionKey: "ssh:host:session-1",
        turnIndex: 0,
        startedAt: "2026-08-28T10:00:00",
        endedAt: "2026-08-28T11:00:00",
        activeSeconds: 3600,
        cwdKey: "remote:drifty_mac",
        model: "gpt-5",
        totalTokens: 200,
      }],
      commits: [],
      agentSummary: { wallClockSeconds: 3600, cumulativeSeconds: 3600, concurrencyPeak: 1, parallelFactor: 1, spans: [] },
    });
    trackerClient.getTimeline.mockResolvedValue([]);

    const hook = renderHook(() => useAgentsData("2026-08-28", "2026-08-28", 0));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    expect(hook.result.current.days[0]?.turns[0]).toEqual([
      600, 660, "codex", "drifty_mac", "gpt-5", 200,
    ]);
  });
});
