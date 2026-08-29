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
});
