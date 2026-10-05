// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DeleteHistoryModal } from "./DeleteHistoryModal";

const { deleteHistoryRange, clearIconCaches } = vi.hoisted(() => ({ deleteHistoryRange: vi.fn(), clearIconCaches: vi.fn() }));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { deleteHistoryRange, clearIconCaches },
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
    clearIconCaches.mockReset().mockResolvedValue({ reclaimedBytes: 0 });
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

  describe("derived icon caches", () => {
    async function deleteRange(rangeLabel: string | null) {
      render(
        <LocalizationTestProvider language="en">
          <DeleteHistoryModal onClose={vi.fn()} onDeleted={vi.fn()} />
        </LocalizationTestProvider>,
      );
      if (rangeLabel) {
        fireEvent.click(screen.getByRole("combobox", { name: "Delete range" }));
        fireEvent.click(screen.getByRole("option", { name: rangeLabel }));
      }
      const del = () => screen.getByRole("button", { name: /Delete permanently|Click again to confirm/ });
      await act(async () => {
        fireEvent.click(del());
      });
      if (rangeLabel === "All time") {
        // A full wipe asks twice before it deletes.
        await act(async () => {
          fireEvent.click(del());
        });
      }
    }

    it("clears the app and site icon caches after a full wipe", async () => {
      await deleteRange("All time");

      expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
      expect(clearIconCaches).toHaveBeenCalledTimes(1);
    });

    it("keeps them for a partial range, whose remaining history still needs its icons", async () => {
      await deleteRange(null);

      expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
      expect(clearIconCaches).not.toHaveBeenCalled();
    });

    it("still reports a completed full wipe when clearing the caches fails", async () => {
      clearIconCaches.mockRejectedValue(new Error("disk busy"));
      await deleteRange("All time");

      expect(screen.getByRole("status").textContent).toContain("12 activity segments");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
