// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FirstDayPreparationScreen, firstDaySourceLabel } from "./FirstDayPreparationScreen";
import { FIRST_DAY_FACT_HOLD_MS } from "./firstDayNarration";
import { buildFirstDayChart, buildFirstDayDiscoveries, buildFirstDayReadingSources } from "./firstDayPreparationStory";
import { buildFirstDayReviewSegments, FIRST_DAY_REVIEW_BATCHES, firstDayReviewSegmentId } from "./firstDayPreparationReviewData";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function progressFillWidth(): number {
  const fill = document.querySelector(".first-day-prep__progress-fill") as HTMLElement | null;
  return Number.parseFloat(fill?.style.width ?? "0");
}

describe("FirstDayPreparationScreen", () => {
  it("shows an indeterminate state with no percent while importing", () => {
    render(<FirstDayPreparationScreen phase="importing" progress={null} />);

    expect(screen.getByText("Getting your day ready")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.className).toContain("first-day-prep__progress--indeterminate");
    expect(progressbar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("renders a real percent and determinate bar while classifying", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.72} />);

    expect(screen.getByText("Making sense of your day")).toBeTruthy();
    expect(screen.getByText("72%")).toBeTruthy();

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.className).not.toContain("first-day-prep__progress--indeterminate");
    expect(progressbar.getAttribute("aria-valuenow")).toBe("72");
  });

  it("clamps progress into the 0-100 range", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={1.4} />);

    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("leads the classifying copy with the user's onboarding work activity", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.4} workActivityLabel="Designing" />);

    expect(screen.getByText("Sorting your Designing time…")).toBeTruthy();
  });

  it("falls back to the generic classifying copy without a work activity", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.4} workActivityLabel={null} />);

    expect(screen.getByText("Reading through your day…")).toBeTruthy();
  });

  it("asks past the time limit whether to keep waiting while the bar stays on screen", () => {
    const onKeepWaiting = vi.fn();
    const onContinueNow = vi.fn();
    render(
      <FirstDayPreparationScreen
        phase="classifying"
        progress={0.46}
        slowWait
        onKeepWaiting={onKeepWaiting}
        onContinueNow={onContinueNow}
      />,
    );

    // The run keeps going, so this is no failure dialog: the progress stays and the question sits under it.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("46");
    expect(screen.getByText("This is taking longer than expected. Sorting keeps going: wait a little longer, or look around now while Drifty finishes the rest.")).toBeTruthy();
    expect(screen.queryByText("This only happens once. Drifty keeps up in the background from now on.")).toBeNull();
    const keepWaiting = screen.getByRole("button", { name: "Keep waiting" });
    expect(document.activeElement).toBe(keepWaiting);
    fireEvent.click(keepWaiting);
    fireEvent.click(screen.getByRole("button", { name: "Continue for now" }));
    expect(onKeepWaiting).toHaveBeenCalledOnce();
    expect(onContinueNow).toHaveBeenCalledOnce();
  });

  it("drops the time-limit question once the day is ready", () => {
    render(<FirstDayPreparationScreen phase="ready" progress={1} slowWait onKeepWaiting={vi.fn()} onContinueNow={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Keep waiting" })).toBeNull();
  });

  it("offers an explicit retry or continue choice after repeated preparation failures", () => {
    const onRetry = vi.fn();
    const onContinueAnyway = vi.fn();
    render(
      <FirstDayPreparationScreen
        failure="classification_incomplete"
        phase="classifying"
        progress={0.4}
        onRetry={onRetry}
        onContinueAnyway={onContinueAnyway}
      />,
    );

    expect(screen.getByRole("alertdialog", { name: "We couldn't finish preparing your day" })).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "Try again" });
    expect(document.activeElement).toBe(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(screen.getByRole("button", { name: "Continue for now" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onContinueAnyway).toHaveBeenCalledOnce();
  });

  it("renders the Korean failure copy and keeps retry as the first action", () => {
    const onRetry = vi.fn();
    const onContinueAnyway = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <FirstDayPreparationScreen
          failure="cloud_not_ready"
          phase="classifying"
          progress={null}
          onRetry={onRetry}
          onContinueAnyway={onContinueAnyway}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("alertdialog", { name: "하루 준비를 완료하지 못했습니다" })).toBeTruthy();
    expect(screen.getByText(/활동 기록은 이 기기에 안전하게 보관되어 있습니다/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.getByRole("button", { name: "우선 계속하기" })).toBeTruthy();
  });

  it("still offers continue when retry is the only remaining action after a timeout", () => {
    render(
      <FirstDayPreparationScreen
        failure="preparation_timed_out"
        phase="classifying"
        progress={0.9}
        onContinueAnyway={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Continue for now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Continue for now" }));
  });

  it("spends one bar across the planned phases instead of restarting it at each handoff", () => {
    const plan = ["importing", "classifying"] as const;
    const { rerender } = render(<FirstDayPreparationScreen phase="importing" plan={plan} progress={null} />);

    rerender(<FirstDayPreparationScreen phase="classifying" plan={plan} progress={0} />);

    // Classification opening at zero still stands on everything the import earned.
    expect(progressFillWidth()).toBeGreaterThan(0);
    expect(screen.getByText("17%")).toBeTruthy();
  });

  it("keeps creeping while a step reports nothing, without running away from the work", () => {
    vi.useFakeTimers();
    render(<FirstDayPreparationScreen phase="importing" progress={null} />);
    // A hard zero reads as "nothing is happening", so the track opens on a nub.
    const opening = progressFillWidth();
    expect(opening).toBeGreaterThan(0);
    expect(opening).toBeLessThan(6);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(progressFillWidth()).toBeGreaterThan(opening);
    expect(progressFillWidth()).toBeLessThan(56);
    // An unmeasurable step still prints no number it cannot back up.
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  });

  it("offers a coarse remaining-time read once classification throughput is measurable", () => {
    vi.useFakeTimers();
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.1} />);
    expect(screen.queryByText(/left$/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.2} />);
    act(() => {
      vi.advanceTimersByTime(1_200);
    });

    expect(screen.getByText("about 1 min left")).toBeTruthy();
  });

  it("explains the wait only once it has run long enough to feel wrong", () => {
    vi.useFakeTimers();
    render(<FirstDayPreparationScreen phase="classifying" progress={0.3} />);
    const note = document.querySelector(".first-day-prep__note") as HTMLElement;
    expect(note.className).not.toContain("first-day-prep__note--visible");

    act(() => {
      vi.advanceTimersByTime(26_000);
    });

    expect(note.className).toContain("first-day-prep__note--visible");
    expect(note.textContent).toContain("only happens once");
  });

  it("lands the wait on a finished bar and an answer before the dashboard takes over", () => {
    render(<FirstDayPreparationScreen phase="ready" progress={1} />);

    expect(screen.getByText("Your day is ready")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(document.querySelector(".first-day-prep__check")).toBeTruthy();
  });

  it("announces the copy but not every tick of the moving bar", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.5} />);

    const live = document.querySelector("[aria-live='polite']") as HTMLElement;
    expect(live.className).toContain("first-day-prep__copy");
    expect(live.querySelector(".first-day-prep__percent")).toBeNull();
    expect(document.querySelector(".first-day-prep__meta")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the completion beat out of the paused state", () => {
    render(
      <FirstDayPreparationScreen
        failure="classification_incomplete"
        phase="classifying"
        progress={0.5}
        onContinueAnyway={vi.fn()}
      />,
    );

    expect(screen.queryByText("Your day is ready")).toBeNull();
    expect(document.querySelector(".first-day-prep__check")).toBeNull();
  });
});

describe("FirstDayPreparationScreen classification motion", () => {
  const day = "2026-09-30";
  const discoveriesAt = (classified: number) => buildFirstDayDiscoveries(buildFirstDayReviewSegments(day, classified));

  it("keeps every found source circling the hourglass, and lets a classified one leave", () => {
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.4} discoveries={discoveriesAt(0)} />);
    const stage = document.querySelector(".first-day-prep__stage");
    expect(stage?.querySelectorAll("[data-token]")).toHaveLength(discoveriesAt(0).items.length);
    expect(stage?.querySelectorAll('[data-token][data-verdict="pending"]')).toHaveLength(discoveriesAt(0).items.length);
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.6} discoveries={discoveriesAt(12)} />);
    expect(stage?.querySelectorAll('[data-token]:not([data-verdict="pending"])').length).toBeGreaterThan(0);
  });

  it("shows only the icons while waiting: no day chart and no Focus, Neutral or Drift totals", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.6} discoveries={discoveriesAt(12)} />);
    expect(document.querySelector(".first-day-prep__ribbon")).toBeNull();
    expect(document.querySelector(".focus-drift-pill")).toBeNull();
    expect(document.querySelector(".bar-row")).toBeNull();
  });

  it("closes on the prepared day's longest focus once it is ready", () => {
    const chart = buildFirstDayChart(buildFirstDayReviewSegments(day, 99));
    expect(chart?.longestFocus).toBeTruthy();
    render(<FirstDayPreparationScreen phase="ready" progress={1} chart={chart} dayRelation="yesterday" />);
    expect(screen.getByText(/^Longest focus: /)).toBeTruthy();
    expect(screen.getByText("Here's how yesterday actually went.")).toBeTruthy();
  });

  it("keeps the waiting icons moving before history has loaded", () => {
    render(<FirstDayPreparationScreen phase="importing" progress={null} />);
    expect(document.querySelectorAll(".first-day-prep__token--slot").length).toBeGreaterThan(0);
  });

  it("uses native app icons by bundle identity as soon as the cache resolves, alongside site icons", () => {
    const discoveries = buildFirstDayDiscoveries(buildFirstDayReviewSegments(day, 0, "mixed"));
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.32} discoveries={discoveries} appIcons={{}} />);
    const token = document.querySelector('[data-find-key="app:com.apple.dt.Xcode"]');
    expect(token?.querySelector(".first-day-prep__token-letter")).toBeTruthy();
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.32} discoveries={discoveries} appIcons={{ "com.apple.dt.Xcode": "data:image/png;base64,cached" }} />);
    expect(token?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cached");
    expect(token?.querySelector(".first-day-prep__token-letter")).toBeNull();
    expect(document.querySelector('[data-find-key="site:youtube.com"]')).toBeTruthy();
  });
});

describe("FirstDayPreparationScreen names the work it is doing", () => {
  const day = "2026-09-30";
  const segmentsWith = (classified: ReadonlySet<number>) => buildFirstDayReviewSegments(day, classified);
  const segmentsAfter = (batches: number) => segmentsWith(new Set(FIRST_DAY_REVIEW_BATCHES.slice(0, batches).flat()));
  const stateAfter = (batches: number) => {
    const segments = segmentsAfter(batches);
    return { discoveries: buildFirstDayDiscoveries(segments), chart: buildFirstDayChart(segments) };
  };
  const readingOf = (batchesDone: number, batch: number) =>
    buildFirstDayReadingSources(segmentsAfter(batchesDone), FIRST_DAY_REVIEW_BATCHES[batch].map(firstDayReviewSegmentId));
  const line = () => document.querySelector(".first-day-prep__line") as HTMLElement;

  it("names the sources the batch in flight is reading and marks their icons on the ring", () => {
    render(<FirstDayPreparationScreen phase="classifying" progress={0.32} {...stateAfter(0)} reading={readingOf(0, 0)} />);

    expect(line().textContent).toBe("Reading github.com and 2 more in context…");
    expect(document.querySelector('[data-find-key="site:github.com"]')?.getAttribute("data-reading")).toBe("true");
    expect(document.querySelector('[data-find-key="site:youtube.com"]')?.hasAttribute("data-reading")).toBe(false);
  });

  it("gives a longest focus that appears a moment of the line, then returns to the batch being read", () => {
    vi.useFakeTimers();
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.32} {...stateAfter(0)} reading={readingOf(0, 0)} />);
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.5} {...stateAfter(1)} reading={readingOf(1, 1)} />);

    // The first batch joins two GitHub stretches into an hour; no per-source verdict is spoken.
    expect(line().textContent).toMatch(/^Longest focus so far: 1h from /u);

    act(() => {
      vi.advanceTimersByTime(FIRST_DAY_FACT_HOLD_MS);
    });
    expect(line().textContent).toBe("Reading youtube.com and 2 more in context…");
  });

  it("says when context sorted one source two ways, without dividing its time (the dashboard does that next)", () => {
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.5} {...stateAfter(1)} />);
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.7} {...stateAfter(2)} />);

    expect(line().textContent).toBe("youtube.com · sorted by what you were doing there, not by name");
    expect(line().textContent).not.toMatch(/\d+m|Focus|Drift/u);
  });

  it("notices a split that only forms once a later batch adds the rest of a source", () => {
    const youtubeDrift = [2, 15, 22];
    const firstPass = new Set([...FIRST_DAY_REVIEW_BATCHES[0], ...youtubeDrift]);
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.5} discoveries={buildFirstDayDiscoveries(segmentsWith(firstPass))} />);
    // The work tutorial (entry 8) arrives in a later batch and only then makes YouTube a split.
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.6} discoveries={buildFirstDayDiscoveries(segmentsWith(new Set([...firstPass, 8])))} />);

    expect(line().textContent).toBe("youtube.com · sorted by what you were doing there, not by name");
  });

  it("treats what was already known when the screen opened as background, not news", () => {
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.5} {...stateAfter(1)} reading={readingOf(1, 1)} />);
    expect(line().textContent).toBe("Reading youtube.com and 2 more in context…");

    // Between batches the line keeps the latest fact instead of going back to generic copy.
    rerender(<FirstDayPreparationScreen phase="classifying" progress={0.5} {...stateAfter(1)} />);
    expect(line().textContent).toMatch(/^Longest focus so far: 1h from /u);
  });

  it("writes the Korean lines without a particle that depends on the source's name", () => {
    const { rerender } = render(
      <LocalizationTestProvider language="ko">
        <FirstDayPreparationScreen phase="classifying" progress={0.32} {...stateAfter(0)} reading={readingOf(0, 0)} />
      </LocalizationTestProvider>,
    );
    expect(line().textContent).toBe("github.com 외 2개의 맥락을 읽고 있습니다…");

    rerender(
      <LocalizationTestProvider language="ko">
        <FirstDayPreparationScreen phase="classifying" progress={0.5} {...stateAfter(1)} reading={readingOf(1, 1)} />
      </LocalizationTestProvider>,
    );
    expect(line().textContent).toMatch(/^지금까지 가장 긴 집중: .+부터 1시간$/u);
  });

  it("closes on what it went through before the longest focus", () => {
    render(
      <LocalizationTestProvider language="ko">
        <FirstDayPreparationScreen phase="ready" progress={1} {...stateAfter(FIRST_DAY_REVIEW_BATCHES.length)} dayRelation="yesterday" />
      </LocalizationTestProvider>,
    );

    expect(line().textContent).toBe("사이트 13곳, 어제 7시간 21분의 기록을 모두 살펴봤습니다.");
    expect(screen.getByText(/^가장 긴 집중: /u)).toBeTruthy();
  });

  it("keeps the fast-changing lines out of the announcements while the receipt is still announced", () => {
    const { rerender } = render(<FirstDayPreparationScreen phase="classifying" progress={0.32} {...stateAfter(0)} reading={readingOf(0, 0)} />);
    expect(line().getAttribute("aria-live")).toBe("off");

    rerender(<FirstDayPreparationScreen phase="ready" progress={1} discoveries={stateAfter(FIRST_DAY_REVIEW_BATCHES.length).discoveries} />);
    expect(line().textContent).toBe("Went through today's 7h 21m across 13 sites.");
    expect(line().hasAttribute("aria-live")).toBe(false);
  });
});

describe("firstDaySourceLabel", () => {
  it("keeps ordinary names and shortens a long app name so the line stays on one row", () => {
    expect(firstDaySourceLabel("github.com")).toBe("github.com");
    const long = firstDaySourceLabel("Microsoft Visual Studio Code - Insiders Edition");
    expect(Array.from(long)).toHaveLength(28);
    expect(long.endsWith("…")).toBe(true);
    expect(firstDaySourceLabel("한글로 된 아주 긴 업무용 앱 이름이 여기에 있습니다 정말로")).toMatch(/…$/u);
  });
});
