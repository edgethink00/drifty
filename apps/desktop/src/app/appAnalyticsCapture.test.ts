import { beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  capturePostHogDailyEvent: vi.fn(),
}));

vi.mock("../lib/analytics/posthogClient", () => ({
  capturePostHogDailyEvent: analyticsMocks.capturePostHogDailyEvent,
  toAnalyticsErrorKind: (value: unknown) => (String(value).includes("network") ? "network" : "unknown"),
  toCountBucket: (value: number) => (value === 0 ? "none" : value === 1 ? "1" : "2_5"),
  toDailyDedupKey: (properties: Readonly<Record<string, unknown>>) => Object.keys(properties)
    .sort()
    .map((key) => `${key}=${String(properties[key])}`)
    .join("|"),
}));

const {
  captureAiClassificationRun,
  captureScheduledProjectPass,
} = await import("./appAnalytics");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scheduled project pass capture policy", () => {
  it("says nothing when the hourly tick had no work to do", () => {
    // The scheduler ticks every hour whether or not anything happened. A skip is
    // the tick reporting its own existence, so it is not a measurement at all.
    captureScheduledProjectPass("schedule", { status: "skipped", reason: "no_work" });
    captureScheduledProjectPass("open", { status: "skipped", reason: "analysis_disconnected" });

    expect(analyticsMocks.capturePostHogDailyEvent).not.toHaveBeenCalled();
  });

  it("reports a real pass once a day per distinct outcome", () => {
    captureScheduledProjectPass("schedule", {
      status: "completed",
      summary: { ran: true, chunks: 1, assignments: 1, corrections: 0, tokensIn: 10, tokensOut: 2, failedChunks: 0 },
    });

    expect(analyticsMocks.capturePostHogDailyEvent).toHaveBeenCalledWith(
      "project_classification_run",
      "assignment_count_bucket=1|correction_count_bucket=none|result=success|trigger=schedule",
      {
        trigger: "schedule",
        result: "success",
        assignment_count_bucket: "1",
        correction_count_bucket: "none",
      },
    );
  });

  it("keeps a failure reportable and separate from a success", () => {
    captureScheduledProjectPass("eod", { status: "failed", category: "provider_error" });

    const [, dedupKey, properties] = analyticsMocks.capturePostHogDailyEvent.mock.calls[0] ?? [];
    expect(properties).toMatchObject({ result: "error", error_kind: "provider_error" });
    expect(dedupKey).toContain("error_kind=provider_error");
  });
});

describe("AI classification capture policy", () => {
  it("routes every run through the daily cap", () => {
    captureAiClassificationRun("background_threshold", "cloud", "current_day", {
      status: "saved",
      selectedSegments: 1,
      savedRecords: 1,
      message: "Saved 1 classification.",
    });

    expect(analyticsMocks.capturePostHogDailyEvent).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.capturePostHogDailyEvent.mock.calls[0]?.[0]).toBe("ai_classification_run");
  });

  it("carries the failure dimensions into the key so a failure never hides behind a success", () => {
    captureAiClassificationRun("live", "local", "current_day", {
      status: "error",
      selectedSegments: 1,
      savedRecords: 0,
      message: "network unreachable",
    });

    const [, dedupKey] = analyticsMocks.capturePostHogDailyEvent.mock.calls[0] ?? [];
    expect(dedupKey).toContain("result=error");
    expect(dedupKey).toContain("error_kind=network");
    expect(dedupKey).toContain("trigger=live");
  });
});
