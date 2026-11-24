// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import { CompanionPillDayReview } from "./CompanionPillDayReview";

afterEach(cleanup);

const reviewEvent: EndOfDayReviewEvent = {
  kind: "endOfDayReview",
  day: "2026-08-02",
  generatedAt: "2026-08-02T18:00:00.000Z",
  trackedLabel: "6h 34m tracked",
  focusLabel: "4h 12m focus",
  driftLabel: "58m drift",
  totalSeconds: 23_640,
  focusSeconds: 15_120,
  driftSeconds: 3_480,
  neutralSeconds: 4_140,
  unclassifiedSeconds: 900,
  topSource: null,
  sourceSummaries: [
    { appName: "VS Code", sourceLabel: "VS Code", durationSeconds: 9_660, percent: 41 },
    { appName: "Figma", sourceLabel: "Figma", durationSeconds: 5_460, percent: 23 },
    { appName: "Slack", sourceLabel: "Slack", durationSeconds: 2_640, percent: 11 },
  ],
  highlightLabel: "Best this week",
  comparison: {
    focusDeltaSeconds: 2_280,
    driftDeltaSeconds: -540,
    otherDeltaSeconds: 300,
  },
  dailySignals: {
    deepSessionCount: 3,
    longestFocusRunSeconds: 6_480,
    longestFocusRunStartedAt: "2026-08-02T10:20:00",
    peakHourLabel: "10:00",
    peakHourFocusSeconds: 3_120,
  },
};

function renderReview(
  event: EndOfDayReviewEvent,
  options?: {
    language?: DisplayLanguage;
    onDismiss?: () => void;
    onOpenDashboard?: () => void;
    onOpenAiSettings?: () => void;
    onUpgrade?: () => void;
  },
) {
  const onDismiss = options?.onDismiss ?? vi.fn();
  const onOpenDashboard = options?.onOpenDashboard ?? vi.fn();
  const view = render(
    <LocalizationTestProvider language={options?.language ?? "en"}>
      <CompanionPillDayReview
        event={event}
        onDismiss={onDismiss}
        onOpenDashboard={onOpenDashboard}
        onOpenAiSettings={options?.onOpenAiSettings}
        onUpgrade={options?.onUpgrade}
      />
    </LocalizationTestProvider>,
  );
  return { ...view, onDismiss, onOpenDashboard };
}

describe("CompanionPillDayReview", () => {
  it("renders daily limit reached badge and quota exceeded title for cloud 429 quota exhaustion", () => {
    const onUpgrade = vi.fn();
    const quotaEvent: EndOfDayReviewEvent = {
      ...reviewEvent,
      totalSeconds: reviewEvent.totalSeconds,
      focusSeconds: 0,
      driftSeconds: 0,
      neutralSeconds: 0,
      unclassifiedSeconds: reviewEvent.totalSeconds,
      highlightLabel: undefined,
      comparison: undefined,
      dailySignals: undefined,
      leaderboardCelebration: undefined,
      assessment: {
        state: "pending",
        route: "cloud",
        reason: "cloud_quota_exceeded",
        recoveryAction: "upgrade",
        cloudQuota: { window: "day", retryAtMs: null },
        unavailableSince: "2026-09-11T10:00:00.000Z",
      },
    };

    renderReview(quotaEvent, { onOpenAiSettings: vi.fn(), onUpgrade });

    expect(screen.getByText("Daily limit reached")).toBeTruthy();
    expect(screen.getByText("Daily AI classification limit reached")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it("keeps an unverified Cloud plan quiet without presenting assessed focus totals", () => {
    renderReview({ ...reviewEvent, assessment: {
      state: "pending", route: "cloud", reason: "cloud_entitlement_unavailable", recoveryAction: null,
    } });
    expect(screen.queryByText(/AI disconnected|plan check failed|classification is paused/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "AI settings" })).toBeNull();
    expect(screen.queryByText("4h 12m")).toBeNull();
    expect(screen.getByRole("button", { name: "See full day" })).toBeTruthy();
  });

  it.each(["minute", "hour", "day", null] as const)("keeps paid %s quota quiet and unassessed", (window) => {
    const onUpgrade = vi.fn(), onOpenAiSettings = vi.fn();
    renderReview({ ...reviewEvent, assessment: {
      state: "pending", route: "cloud", reason: "cloud_quota_exceeded", recoveryAction: null,
      cloudQuota: { window, retryAtMs: new Date("2026-10-06T15:00:00Z").getTime() },
    } }, { onUpgrade, onOpenAiSettings });
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).toBeNull();
    expect(screen.queryByText(/limit reached|retry at|quota|AI disconnected/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "AI settings" })).toBeNull();
    expect(screen.getByText("Tracked time")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See full day" })).toBeTruthy();
    expect(onOpenAiSettings).not.toHaveBeenCalled();
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("uses the stored recovery action rather than deriving Upgrade from a quota reason", () => {
    renderReview({ ...reviewEvent, assessment: { state: "pending", route: "cloud", reason: "cloud_quota_exceeded", recoveryAction: null } }, { onUpgrade: vi.fn(), onOpenAiSettings: vi.fn() });
    expect(screen.queryByText(/Trial users/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).toBeNull();
  });

  it("renders AI disconnected badge only when the provider is genuinely disconnected", () => {
    const disconnectedEvent: EndOfDayReviewEvent = {
      ...reviewEvent,
      totalSeconds: reviewEvent.totalSeconds,
      focusSeconds: 0,
      driftSeconds: 0,
      neutralSeconds: 0,
      unclassifiedSeconds: reviewEvent.totalSeconds,
      highlightLabel: undefined,
      comparison: undefined,
      dailySignals: undefined,
      leaderboardCelebration: undefined,
      assessment: {
        state: "pending",
        route: "cloud",
        reason: "cloud_disconnected",
        recoveryAction: "retry",
        unavailableSince: "2026-09-11T10:00:00.000Z",
      },
    };

    renderReview(disconnectedEvent);

    expect(screen.getByText("AI disconnected")).toBeTruthy();
  });

  it("reproduces every reviewed block from the prototype", () => {
    const { container, onDismiss, onOpenDashboard } = renderReview(reviewEvent);

    expect(screen.getByText("Best this week")).toBeTruthy();
    // The head row is Focus (4:12, captioned with the 6:34 tracked total) and
    // Longest streak (1:48, from the minute that run actually began). The
    // head carries no "vs yesterday" delta; the comparison lives on the ring rows.
    expect(screen.getByText("Focus", { selector: ".eodsec" })).toBeTruthy();
    expect(screen.getAllByText("4:12").length).toBeGreaterThan(0);
    expect(screen.getByText("of 6:34 tracked")).toBeTruthy();
    expect(screen.getByText("Longest streak")).toBeTruthy();
    expect(screen.getByText("1:48")).toBeTruthy();
    expect(screen.getByText("from 10:20 AM")).toBeTruthy();
    expect(screen.queryByText(/vs yesterday/)).toBeNull();
    expect(screen.queryByText("Work hours")).toBeNull();
    expect(screen.getByText("0:58")).toBeTruthy();
    expect(screen.getByText("0:44")).toBeTruthy();
    expect(screen.getByText("▼9m")).toBeTruthy();
    expect(screen.getByText("Deep sessions")).toBeTruthy();
    expect(screen.getByText("45m+ each · best 1:48")).toBeTruthy();
    expect(screen.getByText("Peak hour")).toBeTruthy();
    expect(screen.getByText("52m focused")).toBeTruthy();
    expect(container.querySelectorAll(".eodapp")).toHaveLength(3);
    expect(container.querySelector(".moment-brand .moment-brand__mark")).toBeTruthy();

    const ring = container.querySelector<HTMLElement>(".eodv6__ring");
    expect(ring?.style.background).toContain("conic-gradient");
    // Unrated time is a system state, not a fourth kind of time: Neutral is the
    // whole non-focus, non-drift remainder (6:34 - 4:12 - 0:58 = 1:24) instead
    // of splitting off an Unclassified slice/row.
    expect(ring?.style.background).not.toContain("var(--p-unclassified)");
    expect(screen.getByText("Neutral")).toBeTruthy();
    expect(screen.queryByText("Unclassified")).toBeNull();
    expect(screen.getByText("1:24")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "See full day" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle("Dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("accents only the better direction of each change against the day before", () => {
    const { container } = renderReview({ ...reviewEvent, comparison: { focusDeltaSeconds: -600, driftDeltaSeconds: 900, otherDeltaSeconds: 0 } });
    const deltas = Array.from(container.querySelectorAll(".eodv12__cats .eod__delta[data-delta]"));
    // Less focus and more drift are reported plainly, never in the accent; no change shows no arrow.
    expect(deltas.map((delta) => [delta.textContent, delta.getAttribute("data-delta")])).toEqual([
      ["▼10m", "flat"], ["▲15m", "flat"],
    ]);
    expect(deltas[0].getAttribute("title")).toBe("vs. the day before at this time");
    cleanup();
    const better = renderReview({ ...reviewEvent, comparison: { focusDeltaSeconds: 600, driftDeltaSeconds: -900, otherDeltaSeconds: 300 } });
    expect(Array.from(better.container.querySelectorAll(".eodv12__cats .eod__delta[data-delta]")).map((delta) => delta.getAttribute("data-delta")))
      .toEqual(["good", "good", "flat"]);
    cleanup();
    // A catch-up review compares two finished days, and says so.
    const wholeDay = renderReview({ ...reviewEvent, comparison: { focusDeltaSeconds: 600, driftDeltaSeconds: 0, otherDeltaSeconds: 0, scope: "wholeDay" } });
    expect(wholeDay.container.querySelector(".eodv12__cats .eod__delta[data-delta]")?.getAttribute("title")).toBe("vs. the whole day before");
  });

  it("keeps English copy when the display language is English", () => {
    renderReview(reviewEvent, { language: "en" });
    expect(screen.getByText("Day review")).toBeTruthy();
    expect(screen.getByText("Focus", { selector: ".eodsec" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "See full day" })).toBeTruthy();
    expect(screen.queryByText("하루 리뷰")).toBeNull();
    expect(screen.queryByText("하루 전체 보기")).toBeNull();
  });

  it("renders Korean chrome from the display-language preference", () => {
    const { container } = renderReview(reviewEvent, { language: "ko" });

    expect(screen.getByText("하루 리뷰")).toBeTruthy();
    expect(screen.getByText("집중", { selector: ".eodsec" })).toBeTruthy();
    expect(screen.getByText("기록 6:34 중")).toBeTruthy();
    expect(screen.getByText("최장 집중")).toBeTruthy();
    expect(screen.getByText("오전 10:20부터")).toBeTruthy();
    expect(screen.getByText("딴짓")).toBeTruthy();
    expect(screen.getByText("중립")).toBeTruthy();
    expect(screen.getByText("▼9분")).toBeTruthy();
    expect(screen.getByText("깊은 세션")).toBeTruthy();
    expect(screen.getByText("각 45분+ · 최장 1:48")).toBeTruthy();
    expect(screen.getByText("최고 시간대")).toBeTruthy();
    expect(screen.getByText("52분 집중")).toBeTruthy();
    expect(screen.getByText("주요 앱")).toBeTruthy();
    expect(screen.getByRole("button", { name: "하루 전체 보기" })).toBeTruthy();
    expect(screen.getByTitle("닫기")).toBeTruthy();
    expect(container.querySelector("[data-locale='ko']")).toBeTruthy();
    expect(screen.queryByText("Day review")).toBeNull();
    expect(screen.queryByText("See full day")).toBeNull();
    expect(screen.getByText("Best this week")).toBeTruthy();
  });

  it("updates copy when the language preference changes", () => {
    function Harness() {
      const [language, setLanguage] = useState<DisplayLanguage>("en");
      return (
        <>
          <button type="button" onClick={() => setLanguage((current) => (current === "en" ? "ko" : "en"))}>
            toggle language
          </button>
          <LocalizationTestProvider language={language}>
            <CompanionPillDayReview
              event={reviewEvent}
              onDismiss={vi.fn()}
              onOpenDashboard={vi.fn()}
            />
          </LocalizationTestProvider>
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByText("Day review")).toBeTruthy();
    expect(screen.getByText("of 6:34 tracked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "toggle language" }));
    expect(screen.getByText("하루 리뷰")).toBeTruthy();
    expect(screen.getByText("기록 6:34 중")).toBeTruthy();
    expect(screen.queryByText("Day review")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "toggle language" }));
    expect(screen.getByText("Day review")).toBeTruthy();
    expect(screen.queryByText("하루 리뷰")).toBeNull();
  });

  it("keeps raw day facts but withholds AI-derived conclusions while classification is pending", () => {
    const onOpenAiSettings = vi.fn();
    const onOpenDashboard = vi.fn();
    const pendingEvent: EndOfDayReviewEvent = {
      ...reviewEvent,
      focusSeconds: 0,
      driftSeconds: 0,
      neutralSeconds: 0,
      unclassifiedSeconds: reviewEvent.totalSeconds,
      highlightLabel: undefined,
      comparison: undefined,
      dailySignals: undefined,
      leaderboardCelebration: undefined,
      assessment: {
        state: "pending",
        route: "cloud",
        reason: "cloud_trial_expired",
        recoveryAction: "upgrade",
        unavailableSince: "2026-08-02T14:20:00.000Z",
      },
    };

    const { container } = renderReview(pendingEvent, { onOpenDashboard, onOpenAiSettings, onUpgrade: onOpenAiSettings });

    expect(screen.getByText("Trial ended")).toBeTruthy();
    expect(screen.getByText("Tracked time")).toBeTruthy();
    expect(screen.queryByText("Work hours")).toBeNull();
    expect(screen.getByText("Your Pro trial ended")).toBeTruthy();
    expect(screen.queryByText(/Drifty kept tracking/)).toBeNull();
    expect(screen.getByText("6:34")).toBeTruthy();
    expect(screen.getByText("VS Code")).toBeTruthy();
    expect(screen.queryByText("Focus")).toBeNull();
    expect(screen.queryByText("Deep sessions")).toBeNull();
    expect(screen.queryByText("Peak hour")).toBeNull();
    expect(screen.queryByText("Best this week")).toBeNull();
    expect(container.querySelector(".eodv6__donut")).toBeNull();
    expect(container.querySelector(".eodv12__pending-mark")).toBeNull();

    const pendingNotice = screen.getByText("Your Pro trial ended").closest(".eodv12__pending");
    expect(pendingNotice?.getAttribute("data-tone")).toBe("trial-ended");
    expect(pendingNotice?.querySelector("button")?.textContent).toBe("Upgrade to Pro");
    expect(pendingNotice?.querySelector("button")?.classList.contains("act--primary")).toBe(true);
    expect(screen.getByText("Top apps").closest(".eodv12b--apps")?.querySelector("button")?.textContent).toBe("See tracked day");

    fireEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(onOpenAiSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "See tracked day" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });

  it("localizes pending recovery copy in Korean", () => {
    const pendingEvent: EndOfDayReviewEvent = {
      ...reviewEvent,
      focusSeconds: 0,
      driftSeconds: 0,
      dailySignals: undefined,
      highlightLabel: undefined,
      assessment: {
        state: "pending",
        route: "cloud",
        reason: "cloud_trial_expired",
        recoveryAction: "upgrade",
      },
    };

    renderReview(pendingEvent, { language: "ko", onOpenAiSettings: vi.fn(), onUpgrade: vi.fn() });
    expect(screen.getByText("체험 종료")).toBeTruthy();
    expect(screen.getByText("기록 시간")).toBeTruthy();
    expect(screen.getByText("Pro 체험이 끝났습니다")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pro로 업그레이드" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "기록된 하루 보기" })).toBeTruthy();
  });

  it("keeps non-trial AI recovery notices visually neutral", () => {
    const pendingEvent: EndOfDayReviewEvent = {
      ...reviewEvent,
      assessment: {
        state: "pending",
        route: "none",
        reason: "provider_not_configured",
        recoveryAction: "connect",
      },
    };

    renderReview(pendingEvent, { onOpenAiSettings: vi.fn() });

    const pendingNotice = screen.getByText("Connect AI to finish this review").closest(".eodv12__pending");
    expect(pendingNotice?.hasAttribute("data-tone")).toBe(false);
    expect(screen.getByRole("button", { name: "AI settings" })).toBeTruthy();
  });
  it("shows no change arrow for a change under a minute", () => {
    renderReview({ ...reviewEvent, comparison: { focusDeltaSeconds: 2_280, driftDeltaSeconds: -540, otherDeltaSeconds: 20 } });
    expect(document.querySelectorAll(".eod__row .eod__delta[data-delta]")).toHaveLength(2);
    // The empty cell keeps the third row's time aligned without reading as a change.
    expect(document.querySelectorAll(".eod__row .eod__delta:not([data-delta])")).toHaveLength(1);
  });
});
