// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginSupportOperation, readSupportOperations } from "./supportOperations";
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T00:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("local content-free Chat attempts", () => {
  it("keeps an earlier failure when repeated successful attempts fill the bounded journal", () => {
    beginSupportOperation("cloud").finish("error", "provider", 0, null);
    for (let i = 0; i < 45; i++) beginSupportOperation("codex").finish("done", null, 0, 0);
    const attempts = readSupportOperations();
    expect(attempts).toHaveLength(40);
    expect(attempts.filter(item => item.result === "error")).toMatchObject([{ provider: "cloud", errorCode: "provider" }]);
  });
  it("connects start, first response and outcome without conversation or content fields", () => {
    const operation = beginSupportOperation("codex"); vi.advanceTimersByTime(120); operation.firstResponse();
    vi.advanceTimersByTime(380); operation.firstResponse(); operation.finish("error", "private error title", 3, 1);
    expect(readSupportOperations()).toMatchObject([{ provider: "codex", phase: "finish", result: "error", errorCode: "other",
      durationMs: 500, firstResponseMs: 120, toolCalls: 3, exitCode: 1 }]);
    expect(localStorage.getItem("drifty.support.operations.v1")).not.toContain("private error");
  });
  it("bounds retained attempts, survives reload, and expires them after 14 days", () => {
    for (let i = 0; i < 45; i++) beginSupportOperation("cloud");
    expect(readSupportOperations()).toHaveLength(40);
    vi.advanceTimersByTime(15 * 86_400_000); expect(readSupportOperations()).toEqual([]);
  });
  it("cannot stop Chat if local storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => beginSupportOperation("claude").finish("done", null, 0, 0)).not.toThrow();
  });
  it("revalidates stored entries before attaching them", () => {
    localStorage.setItem("drifty.support.operations.v1", JSON.stringify([{ id: "7c6bfe27-92c9-4d42-a8f1-4ac2b5198101",
      provider: "codex", startedAt: "2026-11-08T00:00:00.000Z", prompt: "Private note", errorCode: "private-key" }]));
    expect(JSON.stringify(readSupportOperations())).not.toContain("Private"); expect(readSupportOperations()[0].errorCode).toBe("other");
  });
});

