import { describe, expect, it, vi } from "vitest";
import { deleteHistorySelection } from "./historyDeletion";

describe("selected history deletion", () => {
  it("propagates a write failure without clearing local records or refreshing", async () => {
    const onDeleted = vi.fn();
    const refresh = vi.fn();
    await expect(deleteHistorySelection(["record"], {
      deleteRecords: async () => { throw new Error("Storage unavailable"); },
      onDeleted,
      refresh,
    })).rejects.toThrow("Storage unavailable");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports completed deletion separately from failed refresh after pruning stale records", async () => {
    const order: string[] = [];
    const result = await deleteHistorySelection(["record"], {
      deleteRecords: async () => { order.push("write"); },
      onDeleted: (ids) => { expect(ids).toEqual(["record"]); order.push("prune"); },
      refresh: async () => { order.push("refresh"); throw new Error("Read unavailable"); },
    });
    expect(order).toEqual(["write", "prune", "refresh"]);
    expect(result).toEqual({ refreshFailed: true });
  });
});
