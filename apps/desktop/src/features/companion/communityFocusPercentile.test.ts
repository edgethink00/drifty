import { describe, expect, it } from "vitest";
import {
  buildCommunityFocusPercentileModel,
  estimateCommunityFocusPercentile,
  isCommunityFocusPercentileModelFresh,
  minimumEstimatedTopPercent,
  type CommunityFocusPercentileAggregate,
} from "./communityFocusPercentile";

function aggregate(
  period: "daily" | "weekly",
  sampleSize = 50,
  overrides: Partial<CommunityFocusPercentileAggregate> = {},
): CommunityFocusPercentileAggregate {
  return {
    period,
    sample_size: sampleSize,
    participant_count: sampleSize,
    log_mean_minutes: Math.log(period === "daily" ? 180 : 900),
    log_standard_deviation_minutes: 0.6,
    generated_at: "2026-08-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("community focus percentile model", () => {
  it("accepts independently computed daily and weekly aggregate models", () => {
    const daily = buildCommunityFocusPercentileModel(aggregate("daily"), "daily");
    const weekly = buildCommunityFocusPercentileModel(aggregate("weekly"), "weekly");

    expect(daily).toMatchObject({ period: "daily", source: "leaderboard", sampleSize: 50 });
    expect(weekly).toMatchObject({ period: "weekly", source: "leaderboard", sampleSize: 50 });
    expect(weekly?.logMeanMinutes).toBeGreaterThan(daily?.logMeanMinutes ?? 0);
  });

  it("supports complete real-account cohorts larger than the public board limit", () => {
    const model = buildCommunityFocusPercentileModel(aggregate("daily", 500), "daily");

    expect(model).toMatchObject({ sampleSize: 500, participantCount: 500 });
    expect(minimumEstimatedTopPercent(500)).toBe(0.5);
  });

  it("refuses mismatched periods, sample counts, and undersized cohorts", () => {
    expect(buildCommunityFocusPercentileModel(aggregate("weekly"), "daily")).toBeNull();
    expect(buildCommunityFocusPercentileModel(
      aggregate("daily", 50, { participant_count: 49 }),
      "daily",
    )).toBeNull();
    expect(buildCommunityFocusPercentileModel(aggregate("daily", 19), "daily")).toBeNull();
  });

  it("refuses malformed or implausibly flat aggregate parameters", () => {
    expect(buildCommunityFocusPercentileModel(
      aggregate("daily", 50, { log_mean_minutes: Number.NaN }),
      "daily",
    )).toBeNull();
    expect(buildCommunityFocusPercentileModel(
      aggregate("daily", 50, { log_standard_deviation_minutes: 0.1 }),
      "daily",
    )).toBeNull();
  });

  it("does not claim a tail unsupported by the cohort size", () => {
    const model = buildCommunityFocusPercentileModel(aggregate("daily"), "daily");
    const estimate = estimateCommunityFocusPercentile(23 * 60 * 60, model);

    expect(minimumEstimatedTopPercent(50)).toBe(5);
    expect(estimate).toMatchObject({ topPercent: 5, sampleSize: 50, participantCount: 50 });
  });

  it("requires a fresh server-generated timestamp for proactive use", () => {
    const model = buildCommunityFocusPercentileModel(aggregate("daily"), "daily");

    expect(isCommunityFocusPercentileModelFresh(model, 12 * 60 * 60 * 1000, Date.parse("2026-08-28T18:00:00.000Z"))).toBe(true);
    expect(isCommunityFocusPercentileModelFresh(model, 12 * 60 * 60 * 1000, Date.parse("2026-08-29T01:00:00.000Z"))).toBe(false);
  });
});
