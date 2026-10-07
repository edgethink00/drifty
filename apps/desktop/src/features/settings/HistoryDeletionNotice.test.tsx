// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { CloudTrialStartedNotice } from "../billing/CloudTrialStartedNotice";
import { AppStatusNotice } from "../updates/AppUpdateStatusNotice";
import { HistoryDeletionNotice } from "./HistoryDeletionNotice";

const result = { activitySegments: 12, classifications: 3, youtubeMetadata: 2, dryRun: false };
function Receipt({ onDismiss }: { onDismiss: () => void }) {
  return <LocalizationTestProvider language="en"><HistoryDeletionNotice result={result} onDismiss={onDismiss} /></LocalizationTestProvider>;
}
describe("HistoryDeletionNotice", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("keeps the complete deletion counts outside page layout and announces the result", () => {
    const { container } = render(<Receipt onDismiss={vi.fn()} />);
    const notice = screen.getByRole("status", { name: "History deleted" });
    expect(within(notice).getByText("12 activity segments · 3 classifications · 2 YouTube metadata entries")).toBeTruthy();
    expect(container.contains(notice)).toBe(false);
    expect(notice.closest(".floating-notice-stack")).toBeTruthy();
    expect(within(notice).getByRole("timer", { name: "Closes in 5 seconds" })).toBeTruthy();
  });

  it("does not restart the countdown when the parent refreshes or its dismissal callback changes", () => {
    vi.useFakeTimers();
    const first = vi.fn(), latest = vi.fn();
    const { rerender } = render(<Receipt onDismiss={first} />);
    act(() => vi.advanceTimersByTime(3_000));
    rerender(<Receipt onDismiss={latest} />);
    act(() => vi.advanceTimersByTime(1_999));
    expect(latest).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    act(() => vi.advanceTimersByTime(500));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("pauses while hovered or focused and resumes only after both leave", () => {
    vi.useFakeTimers(); vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const onDismiss = vi.fn(); render(<Receipt onDismiss={onDismiss} />);
    const notice = screen.getByRole("status", { name: "History deleted" });
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.mouseEnter(notice);
    const dismiss = within(notice).getByRole("button", { name: "Dismiss deletion result" });
    act(() => dismiss.focus()); fireEvent.mouseLeave(notice);
    act(() => vi.advanceTimersByTime(10_000)); expect(onDismiss).not.toHaveBeenCalled();
    act(() => dismiss.blur()); act(() => vi.advanceTimersByTime(2_999)); expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    act(() => vi.advanceTimersByTime(500)); expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("removes only the dismissed item when several app notices share the lane", () => {
    vi.useFakeTimers();
    function Notices() {
      const [open, setOpen] = useState(true);
      return <StrictMode><LocalizationTestProvider language="en">
        <CloudTrialStartedNotice notice={{ accessSource: "standard_trial", trialEndsAt: null }} onDismiss={() => {}} />
        <AppStatusNotice notice={{ title: "Update check", detail: "Up to date", role: "status", compact: true }} />
        {open ? <HistoryDeletionNotice result={result} onDismiss={() => setOpen(false)} /> : null}
      </LocalizationTestProvider></StrictMode>;
    }
    const { unmount } = render(<Notices />);
    expect(document.querySelectorAll(".floating-notice-stack")).toHaveLength(1);
    expect(document.querySelector(".floating-notice-stack")?.children).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss deletion result" }));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("status", { name: "History deleted" })).toBeNull();
    expect(screen.getByRole("status", { name: /trial started/i })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Up to date" })).toBeTruthy();
    unmount(); expect(document.querySelector(".floating-notice-stack")).toBeNull();
  });

  it("cancels a stale countdown on unmount and closes immediately with reduced motion", () => {
    vi.useFakeTimers();
    const stale = vi.fn(); const { unmount } = render(<Receipt onDismiss={stale} />);
    act(() => vi.advanceTimersByTime(3_000)); unmount(); act(() => vi.advanceTimersByTime(5_000)); expect(stale).not.toHaveBeenCalled();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const onDismiss = vi.fn(); render(<Receipt onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss deletion result" })); expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
