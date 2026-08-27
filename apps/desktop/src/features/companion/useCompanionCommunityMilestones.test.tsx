// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommunityFocusPercentileModels } from "./communityFocusPercentile";
import { useCompanionCommunityMilestones } from "./useCompanionCommunityMilestones";

const mocks = vi.hoisted(() => ({
  loadModels: vi.fn(),
  showMilestone: vi.fn().mockResolvedValue(true),
}));

vi.mock("./communityFocusPercentileModelService", () => ({
  loadCommunityFocusPercentileModels: mocks.loadModels,
}));

vi.mock("./watcherBridge", () => ({
  isTauriRuntime: () => true,
  showNativeCompanionMilestone: mocks.showMilestone,
}));

const MODELS: CommunityFocusPercentileModels = {
  daily: {
    version: 1,
    period: "daily",
    source: "leaderboard",
    sampleSize: 50,
    participantCount: 50,
    logMeanMinutes: Math.log(180),
    logStandardDeviationMinutes: 0.6,
    generatedAt: new Date().toISOString(),
  },
  weekly: null,
};

describe("useCompanionCommunityMilestones", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    mocks.loadModels.mockReset();
    mocks.showMilestone.mockReset();
    mocks.showMilestone.mockResolvedValue(true);
  });

  it("delivers the aggregate estimate once without leaderboard membership state", async () => {
    mocks.loadModels.mockResolvedValue(MODELS);
    const { rerender } = renderHook(
      (props: { day: string }) => useCompanionCommunityMilestones({
        ready: true,
        day: props.day,
        focusSecondsToday: 20 * 60 * 60,
        announcementsEnabled: true,
      }),
      { initialProps: { day: "2026-08-28" } },
    );

    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledOnce());
    expect(mocks.showMilestone).toHaveBeenCalledWith(expect.objectContaining({
      id: "companion-community-estimate:2026-08-28:daily-top10",
    }));

    rerender({ day: "2026-08-29" });
    await waitFor(() => expect(mocks.loadModels).toHaveBeenCalled());
    expect(mocks.showMilestone).toHaveBeenCalledTimes(1);
  });

  it("does not double-deliver when React replays effects in Strict Mode", async () => {
    mocks.loadModels.mockResolvedValue(MODELS);

    renderHook(() => useCompanionCommunityMilestones({
      ready: true,
      day: "2026-08-28",
      focusSecondsToday: 20 * 60 * 60,
      announcementsEnabled: true,
    }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    });

    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledOnce());
  });

  it("suppresses a quiet-period crossing instead of replaying it later that day", async () => {
    mocks.loadModels.mockResolvedValue(MODELS);
    const { rerender } = renderHook(
      (props: { announcementsEnabled: boolean }) => useCompanionCommunityMilestones({
        ready: true,
        day: "2026-08-28",
        focusSecondsToday: 20 * 60 * 60,
        announcementsEnabled: props.announcementsEnabled,
      }),
      { initialProps: { announcementsEnabled: false } },
    );

    await waitFor(() => expect(window.localStorage.getItem(
      "drifty.companion.communityMilestones.v1",
    )).toContain('"suppressedDay":"2026-08-28"'));
    rerender({ announcementsEnabled: true });
    expect(mocks.showMilestone).not.toHaveBeenCalled();
  });

  it("retries on a later day after native delivery fails", async () => {
    mocks.loadModels.mockResolvedValue(MODELS);
    mocks.showMilestone.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { rerender } = renderHook(
      (props: { day: string }) => useCompanionCommunityMilestones({
        ready: true,
        day: props.day,
        focusSecondsToday: 20 * 60 * 60,
        announcementsEnabled: true,
      }),
      { initialProps: { day: "2026-08-28" } },
    );

    await waitFor(() => expect(window.localStorage.getItem(
      "drifty.companion.communityMilestones.v1",
    )).toContain('"suppressedDay":"2026-08-28"'));
    rerender({ day: "2026-08-29" });

    await waitFor(() => expect(mocks.showMilestone).toHaveBeenCalledTimes(2));
  });
});
