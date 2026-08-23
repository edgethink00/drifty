// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { FirstDayPreparationScreen } from "./FirstDayPreparationScreen";

afterEach(() => {
  cleanup();
});

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
    expect(screen.getByText(/활동 기록은 이 Mac에 안전하게 보관되어 있습니다/)).toBeTruthy();
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
});
