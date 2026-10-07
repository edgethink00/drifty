// @vitest-environment jsdom
import { useState } from "react";
import type { DeleteHistoryRangeResult } from "@drifty/domain";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DeleteHistoryModal } from "./DeleteHistoryModal";
import { HistoryDeletionNotice } from "./HistoryDeletionNotice";

const { deleteHistoryRange, clearIconCaches } = vi.hoisted(() => ({ deleteHistoryRange: vi.fn(), clearIconCaches: vi.fn() }));
vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: { deleteHistoryRange, clearIconCaches } }));
const counts = { activitySegments: 12, classifications: 0, youtubeMetadata: 2, dryRun: false };

function Harness({ onClose, onDeleted, onCompleted }: {
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
  onCompleted: (result: DeleteHistoryRangeResult) => void;
}) {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<DeleteHistoryRangeResult | null>(null);
  return <LocalizationTestProvider language="en">
    {open ? <DeleteHistoryModal onClose={onClose} onDeleted={onDeleted} onCompleted={(receipt) => {
      onCompleted(receipt); setResult(receipt); setOpen(false);
    }} /> : <button onClick={() => { setResult(null); setOpen(true); }}>Reopen</button>}
    {result ? <HistoryDeletionNotice result={result} onDismiss={() => setResult(null)} /> : null}
  </LocalizationTestProvider>;
}
async function deleteToday(onClose = vi.fn(), onDeleted: () => Promise<void> | void = vi.fn(), onCompleted = vi.fn()) {
  render(<Harness onClose={onClose} onDeleted={onDeleted} onCompleted={onCompleted} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete permanently" })));
  return onCompleted;
}

describe("DeleteHistoryModal completion", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    deleteHistoryRange.mockReset().mockResolvedValue(counts);
    clearIconCaches.mockReset().mockResolvedValue({ reclaimedBytes: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("returns counts outside the dialog without a Done step and dismisses them after five seconds", async () => {
    const completed = await deleteToday();
    expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("12 activity segments · 2 YouTube metadata entries");
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("status")).toBeNull();
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("has no completion timer that can close a reopened dialog", async () => {
    const completed = await deleteToday();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Delete range" }).textContent).toContain("Today");
    expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("explains an invalid date order and enables deletion with the corrected fixed target", async () => {
    const completed = vi.fn();
    render(<Harness onClose={vi.fn()} onDeleted={vi.fn()} onCompleted={completed} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Delete range" }));
    fireEvent.click(screen.getByRole("option", { name: "Custom range" }));
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(screen.getByText("Choose both dates to enable deletion.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete permanently" })).toHaveProperty("disabled", true);
    fireEvent.change(from, { target: { value: "2026-01-10" } });
    fireEvent.change(to, { target: { value: "2026-01-09" } });
    expect(screen.getByRole("alert").textContent).toContain("End date must be on or after");
    expect(to.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(to, { target: { value: "2026-01-11" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(to.getAttribute("aria-invalid")).toBe("false");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete permanently" })));
    expect(deleteHistoryRange).toHaveBeenCalledWith(expect.objectContaining({ start: "2026-01-10", end: "2026-01-11" }));
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate writes and dismissal while the deletion request is pending", async () => {
    let finishWrite!: (result: typeof counts) => void;
    deleteHistoryRange.mockReturnValue(new Promise((resolve) => { finishWrite = resolve; }));
    const onClose = vi.fn();
    const completed = await deleteToday(onClose);
    expect(screen.getByRole("status").textContent).toBe("Deleting…");
    fireEvent.click(screen.getByRole("button", { name: "Processing…" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    await act(async () => finishWrite(counts));
    expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
  });

  it("keeps the target fixed until the post-delete refresh settles", async () => {
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => { finishRefresh = resolve; });
    const onClose = vi.fn();
    const completed = await deleteToday(onClose, () => refresh);
    expect(completed).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Updating views…");
    expect(screen.getByRole("combobox", { name: "Delete range" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Processing…" })).toHaveProperty("disabled", true);
    expect(screen.getAllByRole("button", { name: "Cancel" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finishRefresh(); await refresh; });
    expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retains counts on refresh failure and retries only the refresh before closing", async () => {
    const onDeleted = vi.fn().mockRejectedValueOnce(new Error("View unavailable")).mockResolvedValue(undefined);
    const completed = await deleteToday(vi.fn(), onDeleted);
    expect(completed).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("12 activity segments");
    expect(screen.getByRole("alert").textContent).toContain("The records were deleted");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    const retry = screen.getByRole("button", { name: "Refresh view" });
    expect(document.activeElement).toBe(retry);
    await act(async () => fireEvent.click(retry));
    expect(onDeleted).toHaveBeenCalledTimes(2);
    expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("12 activity segments");
  });

  it("keeps refresh recovery in place while retrying, including a repeated read failure", async () => {
    let failRetry!: (error: Error) => void;
    const onDeleted = vi.fn().mockRejectedValueOnce(new Error("View unavailable"))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failRetry = reject; }));
    const onClose = vi.fn();
    const completed = await deleteToday(onClose, onDeleted);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh view" })));
    expect(screen.getByRole("status").textContent).toContain("12 activity segments");
    expect(screen.getByRole("button", { name: "Processing…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => failRetry(new Error("Still unavailable")));
    expect(screen.getByRole("alert").textContent).toContain("Still unavailable");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refresh view" }));
    expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
  });

  it("retains the requested range when deletion fails and emits no false receipt", async () => {
    deleteHistoryRange.mockRejectedValueOnce(new Error("Write unavailable"));
    const completed = await deleteToday();
    expect(completed).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Write unavailable");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Delete range" }).textContent).toContain("Today");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete permanently" })));
    expect(deleteHistoryRange).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
  });

  describe("derived icon caches", () => {
    async function deleteRange(all: boolean) {
      const completed = vi.fn();
      render(<Harness onClose={vi.fn()} onDeleted={vi.fn()} onCompleted={completed} />);
      if (all) {
        fireEvent.click(screen.getByRole("combobox", { name: "Delete range" }));
        fireEvent.click(screen.getByRole("option", { name: "All time" }));
      }
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete permanently" })));
      if (all) {
        expect(deleteHistoryRange).not.toHaveBeenCalled();
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Click again to confirm" })));
      }
      return completed;
    }
    it("asks twice and clears icon caches after a full wipe", async () => {
      const completed = await deleteRange(true);
      expect(deleteHistoryRange).toHaveBeenCalledTimes(1);
      expect(clearIconCaches).toHaveBeenCalledTimes(1);
      expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
    });
    it("keeps icons for remaining history in a partial deletion", async () => {
      await deleteRange(false);
      expect(clearIconCaches).not.toHaveBeenCalled();
    });
    it("still completes when best-effort cache clearing fails", async () => {
      clearIconCaches.mockRejectedValue(new Error("disk busy"));
      const completed = await deleteRange(true);
      expect(completed).toHaveBeenCalledExactlyOnceWith(counts);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
