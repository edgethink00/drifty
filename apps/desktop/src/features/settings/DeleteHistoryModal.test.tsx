// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DeleteHistoryModal } from "./DeleteHistoryModal";

const { deleteHistoryRange } = vi.hoisted(() => ({ deleteHistoryRange: vi.fn() }));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { deleteHistoryRange },
}));

async function deleteToday(onClose: () => void, onDeleted: () => Promise<void> | void = vi.fn()) {
  render(
    <LocalizationTestProvider language="en">
      <DeleteHistoryModal onClose={onClose} onDeleted={onDeleted} />
    </LocalizationTestProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  });
}

describe("DeleteHistoryModal result", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    deleteHistoryRange.mockReset().mockResolvedValue({ activitySegments: 12, classifications: 0, youtubeMetadata: 2, dryRun: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the result on screen until the user closes it and moves focus to Done", async () => {
    const onClose = vi.fn();
    await deleteToday(onClose);

    expect(screen.getByRole("status").textContent).toContain("12 activity segments");
    const done = screen.getByRole("button", { name: "Done" });
    expect(document.activeElement).toBe(done);

    // The dialog used to close itself 1.6 seconds after deleting.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the finished result with Escape", async () => {
    const onClose = vi.fn();
    await deleteToday(onClose);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the result locked open until the post-delete refresh settles", async () => {
    const onClose = vi.fn();
    let finishRefresh: () => void = () => {};
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    await deleteToday(onClose, () => refresh);

    const done = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
    const closeX = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(closeX.disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      finishRefresh();
      await refresh;
    });
    expect(done.disabled).toBe(false);
    expect(closeX.disabled).toBe(false);
    expect(document.activeElement).toBe(done);
  });
});
