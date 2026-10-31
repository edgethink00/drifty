// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { ActivityDeletionUndoNotice } from "./ActivityDeletionUndoNotice";
import type { PendingActivityDeletionEntry } from "./pendingActivityDeletion";

function Notice({ entry, onUndo = vi.fn(), onClosed = vi.fn() }: {
  readonly entry: PendingActivityDeletionEntry;
  readonly onUndo?: (id: number) => void;
  readonly onClosed?: (id: number) => void;
}) {
  return <LocalizationTestProvider language="en"><ActivityDeletionUndoNotice entry={entry} onUndo={onUndo} onClosed={onClosed} /></LocalizationTestProvider>;
}

describe("ActivityDeletionUndoNotice", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("offers Undo for the deleted activities and closes once Undo is pressed", () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    const onClosed = vi.fn();
    render(<Notice entry={{ id: 4, ids: ["a", "b", "c"], phase: "waiting" }} onUndo={onUndo} onClosed={onClosed} />);
    const notice = screen.getByRole("status", { name: "3 activities deleted" });
    expect(notice.closest(".floating-notice-stack")).toBeTruthy();
    expect(notice.textContent).toContain("It's deleted for good when this notice closes.");
    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledWith(4);
    act(() => vi.advanceTimersByTime(500));
    expect(onClosed).toHaveBeenCalledWith(4);
  });

  it("lets the deletion go through when its window ends", () => {
    vi.useFakeTimers();
    const onClosed = vi.fn();
    render(<Notice entry={{ id: 1, ids: ["a"], phase: "waiting" }} onClosed={onClosed} />);
    expect(screen.getByRole("status", { name: "Activity deleted" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(4_999));
    expect(onClosed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    act(() => vi.advanceTimersByTime(500));
    expect(onClosed).toHaveBeenCalledWith(1);
  });
});
