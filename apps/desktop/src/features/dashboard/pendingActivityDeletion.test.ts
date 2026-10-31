// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePendingActivityDeletion } from "./pendingActivityDeletion";

function setup(commit: (ids: readonly string[]) => Promise<void> = vi.fn(async () => undefined)) {
  const hook = renderHook(() => {
    const pending = usePendingActivityDeletion();
    pending.bindCommit(commit);
    return pending;
  });
  return { hook, commit };
}

describe("Delete, then Undo", () => {
  it("hides the records at once and deletes them only when the notice closes", async () => {
    let finish!: () => void;
    const commit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { hook } = setup(commit);
    act(() => hook.result.current.schedule(["a", "b"]));
    expect([...hook.result.current.hiddenIds]).toEqual(["a", "b"]);
    const notice = hook.result.current.notice!;
    expect(notice).toMatchObject({ ids: ["a", "b"], phase: "waiting" });
    expect(commit).not.toHaveBeenCalled();
    act(() => hook.result.current.settle(notice.id));
    expect(commit).toHaveBeenCalledWith(["a", "b"]);
    // Still hidden while the delete and its refresh run, so the block does not flash back.
    expect(hook.result.current.hiddenIds.has("a")).toBe(true);
    expect(hook.result.current.notice).toBeNull();
    await act(async () => { finish(); });
    expect(hook.result.current.hiddenIds.size).toBe(0);
  });

  it("brings the records back on Undo and never deletes them", () => {
    const { hook, commit } = setup();
    act(() => hook.result.current.schedule(["a"]));
    const { id } = hook.result.current.notice!;
    act(() => hook.result.current.undo(id));
    expect(hook.result.current.hiddenIds.size).toBe(0);
    expect(hook.result.current.notice).toMatchObject({ id, phase: "undone" });
    act(() => hook.result.current.settle(id));
    expect(hook.result.current.notice).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("deletes a waiting deletion as soon as another one starts", () => {
    const { hook, commit } = setup();
    act(() => hook.result.current.schedule(["a"]));
    act(() => hook.result.current.schedule(["b"]));
    expect(commit).toHaveBeenCalledWith(["a"]);
    expect(hook.result.current.notice).toMatchObject({ ids: ["b"], phase: "waiting" });
  });

  it("shows the records again when the delete fails", async () => {
    const { hook } = setup(vi.fn(async () => { throw new Error("disk busy"); }));
    act(() => hook.result.current.schedule(["a"]));
    await act(async () => { hook.result.current.settle(hook.result.current.notice!.id); });
    expect(hook.result.current.hiddenIds.size).toBe(0);
  });

  it("deletes what is still waiting when the page goes away or the app unmounts", () => {
    const { hook, commit } = setup();
    act(() => hook.result.current.schedule(["a"]));
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(commit).toHaveBeenCalledWith(["a"]);
    act(() => hook.result.current.schedule(["b"]));
    hook.unmount();
    expect(commit).toHaveBeenCalledWith(["b"]);
  });
});
