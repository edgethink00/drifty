// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCommunityFocusPercentileModel: vi.fn(),
}));

vi.mock("../leaderboard/leaderboardService", () => ({
  fetchCommunityFocusPercentileModel: mocks.fetchCommunityFocusPercentileModel,
}));

function aggregate(period: "daily" | "weekly", generatedAt = "2026-08-28T12:00:00.000Z") {
  return {
    period,
    sample_size: 50,
    participant_count: 50,
    log_mean_minutes: Math.log(period === "daily" ? 180 : 900),
    log_standard_deviation_minutes: 0.6,
    generated_at: generatedAt,
  };
}

describe("community focus percentile model service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    mocks.fetchCommunityFocusPercentileModel.mockReset();
    vi.resetModules();
  });

  it("loads anon-readable real-account aggregates without membership state", async () => {
    mocks.fetchCommunityFocusPercentileModel.mockImplementation(async (period: "daily" | "weekly") => ({
      success: true,
      error: null,
      data: aggregate(period),
    }));
    const { loadCommunityFocusPercentileModels } = await import("./communityFocusPercentileModelService");

    const models = await loadCommunityFocusPercentileModels();

    expect(mocks.fetchCommunityFocusPercentileModel).toHaveBeenCalledWith("daily");
    expect(mocks.fetchCommunityFocusPercentileModel).toHaveBeenCalledWith("weekly");
    expect(models.daily).toMatchObject({ period: "daily", sampleSize: 50 });
    expect(models.weekly).toMatchObject({ period: "weekly", sampleSize: 50 });
  });

  it("coalesces simultaneous loads into one daily and weekly request", async () => {
    mocks.fetchCommunityFocusPercentileModel.mockImplementation(async (period: "daily" | "weekly") => ({
      success: true,
      error: null,
      data: aggregate(period),
    }));
    const { loadCommunityFocusPercentileModels } = await import("./communityFocusPercentileModelService");

    const [first, second] = await Promise.all([
      loadCommunityFocusPercentileModels(),
      loadCommunityFocusPercentileModels(),
    ]);

    expect(first).toEqual(second);
    expect(mocks.fetchCommunityFocusPercentileModel).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a cached model after the server reports an ineligible cohort", async () => {
    mocks.fetchCommunityFocusPercentileModel.mockImplementation(async (period: "daily" | "weekly") => ({
      success: true,
      error: null,
      data: aggregate(period),
    }));
    const { loadCommunityFocusPercentileModels } = await import("./communityFocusPercentileModelService");
    await loadCommunityFocusPercentileModels();

    mocks.fetchCommunityFocusPercentileModel.mockImplementation(async (period: "daily" | "weekly") => ({
      success: true,
      error: null,
      data: {
        ...aggregate(period),
        sample_size: 19,
        participant_count: 19,
      },
    }));

    await expect(loadCommunityFocusPercentileModels({ forceRefresh: true })).resolves.toEqual({
      daily: null,
      weekly: null,
    });
    expect(window.localStorage.getItem("drifty.companion.communityFocusModels.v1"))
      .toContain('"daily":null');
  });

  it("does not keep arbitrarily old in-memory models after refresh failures", async () => {
    const startMs = Date.parse("2026-08-28T12:00:00.000Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(startMs);
    mocks.fetchCommunityFocusPercentileModel.mockImplementation(async (period: "daily" | "weekly") => ({
      success: true,
      error: null,
      data: aggregate(period),
    }));
    const { loadCommunityFocusPercentileModels } = await import("./communityFocusPercentileModelService");
    await loadCommunityFocusPercentileModels();

    now.mockReturnValue(startMs + 37 * 60 * 60 * 1000);
    mocks.fetchCommunityFocusPercentileModel.mockResolvedValue({
      success: false,
      error: "offline",
      data: null,
    });

    await expect(loadCommunityFocusPercentileModels({ forceRefresh: true })).resolves.toEqual({
      daily: null,
      weekly: null,
    });
  });
});
