// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FirstDayPreparationScreen } from "./FirstDayPreparationScreen";

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
