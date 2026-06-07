// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@dtime/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EndOfDayReview, buildEndOfDayReviewSummary, type EndOfDayReviewEvent } from "./EndOfDayReview";

const reviewDay = "2026-04-06";
const generatedAt = "2026-04-06T23:58:00.000Z";

function buildSegment({
  id,
  appName,
  startHour,
  durationMinutes,
  category,
  productivity,
  siteDomain = null,
  siteTitle = null,
  bundleId = `com.example.${id}`,
}: {
  id: string;
  appName: string;
  startHour: number;
  durationMinutes: number;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  siteDomain?: string | null;
  siteTitle?: string | null;
  bundleId?: string;
}): ActivitySegment {
  const startedAt = new Date(Date.UTC(2026, 3, 6, startHour, 0, 0, 0));
  const endedAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: durationMinutes * 60,
    appName,
    bundleId,
    windowTitle: siteTitle ?? `${appName} window`,
    siteDomain,
    siteTitle,
    siteUrl: siteDomain ? `https://${siteDomain}/work` : null,
    platform: "macos",
    source: "accessibility",
    classification: {
      category,
      productivity,
      source: "manual",
      confidence: 1,
      reason: "Deterministic end-of-day review fixture",
    },
  };
}

function buildReviewEvent(segments: ActivitySegment[]): EndOfDayReviewEvent {
  return buildEndOfDayReviewSummary({
    day: reviewDay,
    generatedAt,
    segments,
  });
}

afterEach(cleanup);

describe("EndOfDayReview", () => {
  it("builds and renders a deterministic local day review", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 90,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "notes-focus-noon",
        appName: "Notes",
        startHour: 12,
        durationMinutes: 30,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "video-drift-afternoon",
        appName: "YouTube",
        startHour: 15,
        durationMinutes: 45,
        category: "entertainment",
        productivity: "drift",
        siteDomain: "youtube.com",
        siteTitle: "Design rabbit hole",
      }),
    ]);

    const { container } = render(<EndOfDayReview event={event} />);

    const review = screen.getByLabelText("Drifty end-of-day review");
    const chrome = container.querySelector(".eodr-chrome");
    expect(chrome).toBeTruthy();
    expect(within(chrome as HTMLElement).getByAltText("Drifty").classList.contains("window-logo")).toBe(true);
    expect.soft(within(review).queryByText("Summary - Today")).not.toBeNull();
    expect.soft(within(review).queryByText("Evening review")).toBeNull();
    expect.soft(within(review).getAllByText("2h 45m").length).toBeGreaterThan(0);

    const focusDriftSummary = within(review).queryByLabelText("Focus and drift summary");
    expect.soft(focusDriftSummary).not.toBeNull();
    expect.soft(container.querySelectorAll(".eodr-metric")).toHaveLength(3);
    expect.soft(container.querySelectorAll(".eodr-meter")).toHaveLength(3);
    expect.soft(within(review).queryByText("2h focus")).not.toBeNull();
    expect.soft(within(review).queryByText("45m drift")).not.toBeNull();
    expect.soft(chrome ? within(chrome as HTMLElement).queryByRole("button", { name: "Review settings" }) : null).not.toBeNull();
    expect.soft(chrome ? within(chrome as HTMLElement).queryByRole("button", { name: "Close end-of-day review" }) : null).not.toBeNull();

    const breakdown = within(review).getByLabelText("End-of-day derived breakdown");
    const focusRow = within(breakdown).getByLabelText("Focus breakdown detail");
    expect(within(focusRow).getByText("Focus")).toBeTruthy();
    expect(within(focusRow).getByText("2h")).toBeTruthy();
    expect(within(focusRow).getByText("72.7%")).toBeTruthy();
    const focusProgress = within(focusRow).getByRole("meter", { name: "Focus progress" });
    expect(focusProgress.getAttribute("aria-valuenow")).toBe("72.7");
    expect(focusProgress.getAttribute("aria-valuetext")).toBe("72.7%");
  });

  it("renders an accessible circular focus and drift graph", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 90,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "video-drift-afternoon",
        appName: "YouTube",
        startHour: 15,
        durationMinutes: 45,
        category: "entertainment",
        productivity: "drift",
      }),
      buildSegment({
        id: "chat-neutral-evening",
        appName: "Messages",
        startHour: 18,
        durationMinutes: 45,
        category: "communication",
        productivity: "neutral",
      }),
    ]);

    const { container } = render(<EndOfDayReview event={event} />);

    expect(screen.getByRole("img", { name: "End-of-day focus and drift breakdown" })).toBeTruthy();
    expect(container.querySelector(".eodr-dial-shell")).toBeTruthy();
    expect(container.querySelector(".eodr-dial")).toBeTruthy();
    expect(container.querySelector(".eodr-dial__track")?.getAttribute("r")).toBe("40");
    expect(container.querySelector(".eodr-dial__segment--focus")?.getAttribute("r")).toBe("40");
    expect(container.querySelector(".eodr-dial__segment--focus")).toBeTruthy();
    expect(container.querySelector(".eodr-dial__segment--drift")).toBeTruthy();
    expect(container.querySelector(".eodr-dial__segment--other")).toBeTruthy();
  });

  it("renders a richer derived focus, drift, and neutral breakdown", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 90,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "video-drift-afternoon",
        appName: "YouTube",
        startHour: 15,
        durationMinutes: 45,
        category: "entertainment",
        productivity: "drift",
      }),
      buildSegment({
        id: "chat-neutral-evening",
        appName: "Messages",
        startHour: 18,
        durationMinutes: 45,
        category: "communication",
        productivity: "neutral",
      }),
    ]);

    render(<EndOfDayReview event={event} />);

    expect.soft(screen.queryByLabelText("Focus and drift summary")).not.toBeNull();
    const breakdown = screen.getByLabelText("End-of-day derived breakdown");
    const rows = within(breakdown).getAllByLabelText(/breakdown detail/);
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Focus breakdown detail",
      "Drift breakdown detail",
      "Neutral breakdown detail",
    ]);
    const focusRow = within(breakdown).getByLabelText("Focus breakdown detail");
    expect(within(focusRow).getByText("Focus")).toBeTruthy();
    expect(within(focusRow).getByText("1h 30m")).toBeTruthy();
    expect(within(focusRow).getByText("50%")).toBeTruthy();
    expect(within(focusRow).getByRole("meter", { name: "Focus progress" }).getAttribute("aria-valuetext")).toBe("50%");

    const driftRow = within(breakdown).getByLabelText("Drift breakdown detail");
    expect(within(driftRow).getByText("Drift")).toBeTruthy();
    expect(within(driftRow).getByText("45m")).toBeTruthy();
    expect(within(driftRow).getByText("25%")).toBeTruthy();
    expect(within(driftRow).getByRole("meter", { name: "Drift progress" }).getAttribute("aria-valuenow")).toBe("25");

    const neutralRow = within(breakdown).getByLabelText("Neutral breakdown detail");
    expect(within(neutralRow).getByText("Neutral")).toBeTruthy();
    expect(within(neutralRow).getByText("45m")).toBeTruthy();
    expect(within(neutralRow).getByText("25%")).toBeTruthy();
    expect(within(neutralRow).getByRole("meter", { name: "Neutral progress" }).getAttribute("aria-valuenow")).toBe("25");
  });

  it("renders the extracted category and most-used app tables from local segments", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 90,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "video-drift-afternoon",
        appName: "YouTube",
        startHour: 15,
        durationMinutes: 50,
        category: "entertainment",
        productivity: "drift",
      }),
      buildSegment({
        id: "figma-focus-afternoon",
        appName: "Figma",
        startHour: 16,
        durationMinutes: 60,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "chat-neutral-evening",
        appName: "Slack",
        startHour: 18,
        durationMinutes: 30,
        category: "communication",
        productivity: "neutral",
      }),
    ]);

    const { container } = render(<EndOfDayReview event={event} />);

    expect(container.querySelector(".end-of-day-review__table-stack")).toBeTruthy();
    const categoryBreakdown = screen.getByLabelText("Category breakdown");
    expect(within(categoryBreakdown).getByText("Categories")).toBeTruthy();
    expect(within(categoryBreakdown).getByText("Workspace")).toBeTruthy();
    expect(within(categoryBreakdown).getByText("Entertainment")).toBeTruthy();
    expect(within(categoryBreakdown).getByText("Communication")).toBeTruthy();

    const mostUsedApps = screen.getByLabelText("Most used apps");
    expect(within(mostUsedApps).getByText("Most used apps")).toBeTruthy();
    expect(within(mostUsedApps).getByText("Code")).toBeTruthy();
    expect(within(mostUsedApps).getByText("Figma")).toBeTruthy();
    expect(within(mostUsedApps).getByText("YouTube")).toBeTruthy();
    expect(within(mostUsedApps).queryByText("Slack")).toBeNull();
    expect(within(mostUsedApps).getByText("1h 30m · 39.1%")).toBeTruthy();
    expect(container.querySelector(".src-tile--code")).toBeTruthy();
    expect(container.querySelector(".glyph--design")).toBeTruthy();
    expect(container.querySelector(".src-tile--yt")).toBeTruthy();
  });

  it("renders native source icons when source summaries include icon data", () => {
    const xcodeIcon = "data:image/png;base64,xcode-icon";
    const event = buildEndOfDayReviewSummary({
      day: reviewDay,
      generatedAt,
      appIcons: { "com.apple.dt.Xcode": xcodeIcon },
      segments: [
        buildSegment({
          id: "xcode-focus-morning",
          appName: "Xcode",
          bundleId: "com.apple.dt.Xcode",
          startHour: 9,
          durationMinutes: 120,
          category: "workspace",
          productivity: "focus",
        }),
        buildSegment({
          id: "slack-neutral-noon",
          appName: "Slack",
          startHour: 12,
          durationMinutes: 30,
          category: "communication",
          productivity: "neutral",
        }),
      ],
    });

    expect(event.sourceSummaries?.[0]).toEqual(expect.objectContaining({
      appName: "Xcode",
      bundleId: "com.apple.dt.Xcode",
      iconSrc: xcodeIcon,
    }));

    const { container } = render(<EndOfDayReview event={event} />);
    const xcodeRow = within(screen.getByLabelText("Most used apps")).getByText("Xcode").closest(".eodr-source-row");

    expect(xcodeRow).toBeTruthy();
    expect(xcodeRow?.querySelector(".app-icon")?.getAttribute("src")).toBe(xcodeIcon);
    expect(xcodeRow?.querySelector(".app-glyph")).toBeNull();
    expect(container.querySelector(".src-tile--app-icon")).toBeTruthy();
  });

  it("calls action callbacks from the review buttons", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 45,
        category: "workspace",
        productivity: "focus",
      }),
    ]);
    const onOpenDashboard = vi.fn();
    const onViewDetails = vi.fn();
    const onOpenNotificationSettings = vi.fn();

    render(
      <EndOfDayReview
        event={event}
        onOpenDashboard={onOpenDashboard}
        onViewDetails={onViewDetails}
        onOpenNotificationSettings={onOpenNotificationSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Review settings" }));

    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "View details" })).toBeNull();
    expect(onViewDetails).not.toHaveBeenCalled();
    expect(onOpenNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("calls the close callback from a top-right close button", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 45,
        category: "workspace",
        productivity: "focus",
      }),
    ]);
    const onClose = vi.fn();

    render(<EndOfDayReview event={event} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close end-of-day review" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens dashboard-style detail on breakdown hover and hides it on leave", () => {
    const event = buildReviewEvent([
      buildSegment({
        id: "code-focus-morning",
        appName: "Code",
        startHour: 9,
        durationMinutes: 90,
        category: "workspace",
        productivity: "focus",
      }),
      buildSegment({
        id: "video-drift-afternoon",
        appName: "YouTube",
        startHour: 15,
        durationMinutes: 45,
        category: "entertainment",
        productivity: "drift",
        siteDomain: "youtube.com",
        siteTitle: "Design rabbit hole",
      }),
    ]);

    render(<EndOfDayReview event={event} />);

    const focusRow = screen.getByLabelText("Focus breakdown detail");
    fireEvent.mouseEnter(focusRow, { clientX: 120, clientY: 80 });

    const detail = screen.getByRole("tooltip", { name: "Focus detail" });
    expect(within(detail).getByText("1h 30m")).toBeTruthy();
    expect(within(detail).getByText("66.7% of tracked time")).toBeTruthy();
    expect(within(detail).getByText("Code")).toBeTruthy();

    fireEvent.mouseLeave(focusRow);

    expect(screen.queryByRole("tooltip", { name: "Focus detail" })).toBeNull();
  });

  it("renders useful empty copy without fake percentages", () => {
    const event = buildReviewEvent([]);

    render(<EndOfDayReview event={event} />);

    const review = screen.getByLabelText("Drifty end-of-day review");
    expect(within(review).getByText("No tracked activity for this day yet.")).toBeTruthy();
    expect(within(review).getByText("Leave Drifty running during a workday and your end-of-day review will appear here."))
      .toBeTruthy();
    expect(review.textContent).not.toMatch(/\b0%\b/);
    expect(review.textContent).not.toMatch(/NaN%/);
  });

  it("keeps actions present for a zero-total review without fake percentages", () => {
    const event = buildReviewEvent([]);

    render(<EndOfDayReview event={event} />);

    const review = screen.getByLabelText("Drifty end-of-day review");
    expect(within(review).getByRole("button", { name: "Open dashboard" })).toBeTruthy();
    expect(within(review).getByRole("button", { name: "Review settings" })).toBeTruthy();
    expect(within(review).queryByRole("button", { name: "View details" })).toBeNull();
    expect(review.textContent).not.toMatch(/\b0%\b/);
    expect(review.textContent).not.toMatch(/NaN%/);
  });

  it("surfaces long app and source labels in the top source summary", () => {
    const longAppName = "A Very Long Research Browser With Workspace Context That Should Stay Readable";
    const longSourceLabel = "deeply-nested-research-board-with-client-context-and-extra-long-slug.example.com";
    const event = buildReviewEvent([
      buildSegment({
        id: "long-source-focus",
        appName: longAppName,
        startHour: 14,
        durationMinutes: 75,
        category: "learning",
        productivity: "focus",
        siteDomain: longSourceLabel,
        siteTitle: "Extremely long research source",
      }),
    ]);

    render(<EndOfDayReview event={event} />);

    const focusBreakdownRow = screen.getByLabelText("Focus breakdown detail");
    expect(within(focusBreakdownRow).getByText("1h 15m")).toBeTruthy();
    expect(within(focusBreakdownRow).getByText("100%")).toBeTruthy();
    const mostUsedApps = screen.queryByLabelText("Most used apps");
    expect.soft(mostUsedApps).not.toBeNull();
    expect.soft(screen.queryByText(longAppName)).not.toBeNull();
    expect.soft(screen.queryByText(longSourceLabel)).not.toBeNull();
  });
});
