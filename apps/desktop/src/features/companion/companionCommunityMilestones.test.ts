import { describe, expect, it } from "vitest";
import {
  buildCommunityFocusPercentileModel,
  estimateCommunityFocusPercentile,
} from "./communityFocusPercentile";
import {
  completeCompanionCommunityMilestoneDelivery,
  evaluateCompanionCommunityMilestone,
  type CompanionCommunityMilestoneProgress,
} from "./companionCommunityMilestones";

const EMPTY_PROGRESS: CompanionCommunityMilestoneProgress = {
  celebratedDailyTopTen: false,
  suppressedDay: null,
};

function dailyModel() {
  return buildCommunityFocusPercentileModel({
    period: "daily",
    sample_size: 50,
    participant_count: 50,
    log_mean_minutes: Math.log(180),
    log_standard_deviation_minutes: 0.6,
    generated_at: new Date().toISOString(),
  }, "daily");
}

describe("Companion community milestones", () => {
  it("offers one positive Top 10% estimate from a live daily cohort", () => {
    const model = dailyModel();
    expect(model).not.toBeNull();

    const result = evaluateCompanionCommunityMilestone({
      progress: EMPTY_PROGRESS,
      day: "2026-08-28",
      focusSeconds: 20 * 60 * 60,
      model,
      announce: true,
    });

    expect(result.event).toMatchObject({
      id: "companion-community-estimate:2026-08-28:daily-top10",
      title: "Top 10% focus today",
      subtitle: "Estimated from 50 leaderboard participants",
    });
  });

  it("does not send broad or negative percentile messages", () => {
    const result = evaluateCompanionCommunityMilestone({
      progress: EMPTY_PROGRESS,
      day: "2026-08-28",
      focusSeconds: 30 * 60,
      model: dailyModel(),
      announce: true,
    });

    expect(result.event).toBeNull();
  });

  it("uses the unrounded estimate at the Top 10% eligibility boundary", () => {
    const model = dailyModel();
    expect(model).not.toBeNull();
    if (!model) throw new Error("Expected a daily model");

    let firstQualifyingSecond = 0;
    for (let focusSeconds = 1; focusSeconds <= 24 * 60 * 60; focusSeconds += 1) {
      const estimate = estimateCommunityFocusPercentile(focusSeconds, model);
      if (estimate && estimate.topPercent <= 10) {
        firstQualifyingSecond = focusSeconds;
        break;
      }
    }
    expect(firstQualifyingSecond).toBeGreaterThan(1);
    const justOutside = estimateCommunityFocusPercentile(firstQualifyingSecond - 1, model);
    expect(justOutside?.topPercent).toBeGreaterThan(10);
    expect(Math.round((justOutside?.topPercent ?? 0) * 10) / 10).toBe(10);

    const result = evaluateCompanionCommunityMilestone({
      progress: EMPTY_PROGRESS,
      day: "2026-08-28",
      focusSeconds: firstQualifyingSecond - 1,
      model,
      announce: true,
    });
    expect(result.event).toBeNull();
  });

  it("does not proactively notify from a stale cached cohort", () => {
    const model = dailyModel();
    expect(model).not.toBeNull();
    const result = evaluateCompanionCommunityMilestone({
      progress: EMPTY_PROGRESS,
      day: "2026-08-28",
      focusSeconds: 20 * 60 * 60,
      model: model ? { ...model, generatedAt: "2026-08-20T00:00:00.000Z" } : null,
      announce: true,
    });

    expect(result.event).toBeNull();
  });

  it("is lifetime-first after a successful display", () => {
    const completed = completeCompanionCommunityMilestoneDelivery(EMPTY_PROGRESS, "2026-08-28", true);
    const nextDay = evaluateCompanionCommunityMilestone({
      progress: completed,
      day: "2026-08-29",
      focusSeconds: 20 * 60 * 60,
      model: dailyModel(),
      announce: true,
    });

    expect(nextDay.event).toBeNull();
  });

  it("suppresses a muted or budget-rejected achievement only for that day", () => {
    const muted = evaluateCompanionCommunityMilestone({
      progress: EMPTY_PROGRESS,
      day: "2026-08-28",
      focusSeconds: 20 * 60 * 60,
      model: dailyModel(),
      announce: false,
    });
    expect(muted.progress.suppressedDay).toBe("2026-08-28");

    const nextDay = evaluateCompanionCommunityMilestone({
      progress: muted.progress,
      day: "2026-08-29",
      focusSeconds: 20 * 60 * 60,
      model: dailyModel(),
      announce: true,
    });
    expect(nextDay.event).not.toBeNull();
  });
});
