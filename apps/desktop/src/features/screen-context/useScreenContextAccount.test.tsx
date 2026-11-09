// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useScreenContextAccount } from "./useScreenContextAccount";
import { DESKTOP_AUTH_SESSION_CHANGING, DESKTOP_AUTH_SESSION_CHANGED } from "../auth/desktopAuthSessionEvents";
import { SCREEN_CONTEXT_POLICY_CHANGING } from "../../lib/api/screenContextPolicyEvents";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
const A = "5c1c587e-6327-4da4-8290-663195343c62";
const B = "cbb9e134-ffbc-4384-b6b9-6b83cafbef14";
const LEASE = "a9db1b29-80fb-4104-9272-46e0845a4774";
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  vi.mocked(invoke).mockImplementation(async (command) => command === "screen_context_bind_account"
    ? { leaseId: LEASE, value: { mode: "account", expiresAtMs: Date.now() + 900_000 } } : undefined);
});
it("clears already rendered generations on native exclusion changes and only rebinds when policy is ready", async () => {
  const hook = renderHook(() => useScreenContextAccount("authenticated", A));
  const client = hook.result.current;
  await act(() => client.connect());
  const generation = client.getSnapshot().generation;
  act(() => window.dispatchEvent(new Event(SCREEN_CONTEXT_POLICY_CHANGING)));
  expect(client.canDisplay(generation)).toBe(false);
  await act(() => client.connect());
  const nativeGeneration = client.getSnapshot().generation;
  const handlers = new Map(vi.mocked(listen).mock.calls.map(([name, handler]) => [name, handler]));
  vi.mocked(invoke).mockClear();
  act(() => handlers.get("screen-context-invalidated")?.({ event: "screen-context-invalidated", id: 1, payload: null }));
  expect(invoke).toHaveBeenCalledWith("screen_context_revoke_account");
  expect(client.canDisplay(generation)).toBe(false);
  expect(client.canDisplay(nativeGeneration)).toBe(false);
  expect(client.getSnapshot().connection).toBe("idle");
  await act(async () => {
    handlers.get("screen-context-policy-ready")?.({ event: "screen-context-policy-ready", id: 2, payload: null });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(client.getSnapshot().connection).toBe("ready");
  expect(client.getSnapshot().generation).toBeGreaterThan(generation);
  hook.unmount();
});
it("drops Replay evidence for the matching lease without revoking capture", async () => {
  const hook = renderHook(() => useScreenContextAccount("authenticated", A));
  const client = hook.result.current;
  await act(() => client.connect());
  const before = client.getSnapshot();
  const handler = vi.mocked(listen).mock.calls.find(([event]) => event === "screen-context-visibility-changed")?.[1];
  expect(handler).toBeDefined();
  const notify = (payload: unknown) => act(() => handler?.({ event: "screen-context-visibility-changed", id: 1, payload }));
  vi.mocked(invoke).mockClear();
  notify("c65b878f-5e63-40c6-9b2d-8a5c444026f0");
  expect(client.canDisplay(before.generation)).toBe(true);
  notify(LEASE);
  expect(client.canDisplay(before.generation)).toBe(false);
  expect(client.getSnapshot().binding).toBe(before.binding);
  await act(() => client.connect());
  expect(invoke).not.toHaveBeenCalled();
  hook.unmount();
});
it("refuses further content if native invalidation events cannot be registered", async () => {
  vi.mocked(listen).mockRejectedValueOnce(new Error("owned registration failure"));
  const hook = renderHook(() => useScreenContextAccount("authenticated", A));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await expect(hook.result.current.connect()).rejects.toThrow("screen_context_account_unavailable");
  hook.unmount();
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks();
});
it("revokes while Privacy is closed, rebinds only after persistence, and clears on account changes/unmount", async () => {
  const hook = renderHook(({ userId, status }) => useScreenContextAccount(status, userId),
    { initialProps: { userId: A, status: "authenticated" } });
  const client = hook.result.current;
  // Mounting the main app does not read credentials or create an evidence store.
  expect(invoke).not.toHaveBeenCalledWith("screen_context_bind_account", expect.anything());
  await act(() => client.connect());
  expect(client.getSnapshot().connection).toBe("ready");
  const old = client.getSnapshot().generation;
  act(() => { window.dispatchEvent(new Event(DESKTOP_AUTH_SESSION_CHANGING)); });
  expect(client.getSnapshot().binding).toBeNull();
  expect(client.isCurrent(old)).toBe(false);
  await act(async () => { window.dispatchEvent(new Event(DESKTOP_AUTH_SESSION_CHANGED)); await vi.advanceTimersByTimeAsync(0); });
  expect(client.getSnapshot().connection).toBe("ready");
  hook.rerender({ userId: B, status: "loading" });
  expect(client.getSnapshot().binding).toBeNull();
  hook.rerender({ userId: B, status: "authenticated" });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(invoke).toHaveBeenCalledWith("screen_context_bind_account", { expectedUserId: B });
  const beforeUnmount = client.getSnapshot().generation;
  hook.unmount();
  expect(client.isCurrent(beforeUnmount)).toBe(false);
  const calls = vi.mocked(invoke).mock.calls.length;
  window.dispatchEvent(new Event(DESKTOP_AUTH_SESSION_CHANGED));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.mocked(invoke).mock.calls).toHaveLength(calls);
  await expect(client.connect()).rejects.toThrow("screen_context_account_unavailable");
});
