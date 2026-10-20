import { describe, expect, it, vi } from "vitest";
import { ManagedLocalAiQueue } from "./managedLocalAiQueue";

describe("managed runtime admission", () => {
  it("lets an active generation finish then admits live classification before queued analysis", async () => {
    const queue = new ManagedLocalAiQueue(); const order: string[] = [];
    let finish!: () => void;
    const active = queue.run("analysis", () => true, () => new Promise<void>(resolve => { finish = resolve; }));
    const heavy = queue.run("analysis", () => true, async () => { order.push("heavy"); });
    const live = queue.run("classification", () => true, async () => { order.push("live"); });
    expect(order).toEqual([]); finish(); await Promise.all([active, heavy, live]);
    expect(order).toEqual(["live", "heavy"]);
  });
  it("does not send stale queued inputs after the connection changes", async () => {
    const queue = new ManagedLocalAiQueue(); let finish!: () => void; let current = true;
    const active = queue.run("analysis", () => true, () => new Promise<void>(resolve => { finish = resolve; }));
    const send = vi.fn(); const waiting = queue.run("classification", () => current, send);
    const rejected = expect(waiting).rejects.toThrow("cancelled"); current = false; finish();
    await Promise.all([active, rejected]); expect(send).not.toHaveBeenCalled();
  });
  it("expires a waiting request without releasing or overlapping the active slot", async () => {
    vi.useFakeTimers();
    try {
      const queue = new ManagedLocalAiQueue(); let finish!: () => void;
      const active = queue.run("analysis", () => true, () => new Promise<void>(resolve => { finish = resolve; }));
      const send = vi.fn(); const waiting = queue.run("analysis", () => true, send, 100);
      const rejected = expect(waiting).rejects.toThrow("busy"); await vi.advanceTimersByTimeAsync(101); await rejected;
      expect(send).not.toHaveBeenCalled(); finish(); await active;
    } finally { vi.useRealTimers(); }
  });
});
