// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFocusCard } from "./useFocusCard";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  build: vi.fn(), fetch: vi.fn(), publish: vi.fn(), refresh: vi.fn(), flags: vi.fn(), enabled: vi.fn(),
}));
vi.mock("./focusCardPublisher", () => ({ buildFocusCardPayloadFromTracker: mocks.build }));
vi.mock("./focusCardService", () => ({
  captureFocusCardConsent: mocks.capture,
  DEFAULT_FOCUS_CARD_DETAIL_FLAGS: { shareCategoryBreakdown: false, shareHourlyPattern: false },
  fetchOwnFocusCard: mocks.fetch, publishFocusCard: mocks.publish, refreshFocusCardAggregates: mocks.refresh,
  setFocusCardDetailFlags: mocks.flags, setFocusCardEnabled: mocks.enabled,
}));
const input = { windowEndDay: "2026-10-04", startOfDayMinutes: 240, includeAiClassifications: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.capture.mockResolvedValue({ success: true, data: "revision-a" });
  mocks.build.mockResolvedValue({ focus_seconds_today: 1800 });
  mocks.fetch.mockResolvedValue({ success: true, data: { enabled: true, detailFlags: { shareCategoryBreakdown: true, shareHourlyPattern: true } } });
  for (const fn of [mocks.publish, mocks.refresh, mocks.flags, mocks.enabled]) fn.mockResolvedValue({ success: true });
});

it.each(["owner-b", null])("hides all old-owner data on the first render for %s", async userId => {
  const renders: Array<{ owner: string | null; enabled: boolean | null; preview: unknown; flags: unknown; error: string | null }> = [];
  const { result, rerender } = renderHook(({ owner }: { owner: string | null }) => {
    const card = useFocusCard({ ...input, userId: owner });
    renders.push({ owner, enabled: card.enabled, preview: card.previewPayload, flags: card.detailFlags, error: card.error });
    return card;
  }, { initialProps: { owner: "owner-a" as string | null } });
  await act(async () => { await result.current.refresh(); });
  expect(result.current.enabled).toBe(true);
  rerender({ owner: userId });
  expect(renders.find(row => row.owner === userId)).toMatchObject({ enabled: null, preview: null, flags: null, error: null });
  expect(result.current.busy).toBe(false);
});

it("never inherits another owner's public opt-in during a detail change", async () => {
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  await act(async () => { await result.current.refresh(); });
  rerender({ owner: "owner-b" });
  await act(async () => { await result.current.setDetailFlag("shareHourlyPattern", false); });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.flags).toHaveBeenCalledWith({ shareCategoryBreakdown: false, shareHourlyPattern: false }, undefined, "owner-b", "revision-a");
});

it("discards an old owner's payload before any public write", async () => {
  const payload = deferred<{ focus_seconds_today: number }>();
  mocks.build.mockReturnValueOnce(payload.promise);
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let task!: Promise<boolean>;
  act(() => { task = result.current.enable(); });
  rerender({ owner: "owner-b" });
  await act(async () => { payload.resolve({ focus_seconds_today: 1800 }); expect(await task).toBe(false); });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ enabled: null, busy: false, error: null, detailFlags: null, previewPayload: null });
});

it("does not revive an old operation after A -> B -> A", async () => {
  const payload = deferred<{ focus_seconds_today: number }>();
  mocks.build.mockReturnValueOnce(payload.promise);
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let task!: Promise<boolean>;
  act(() => { task = result.current.enable(); });
  rerender({ owner: "owner-b" }); rerender({ owner: "owner-a" });
  await act(async () => { payload.resolve({ focus_seconds_today: 1800 }); expect(await task).toBe(false); });
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("invalidates an old refresh and lets the new owner refresh without waiting", async () => {
  const payload = deferred<{ focus_seconds_today: number }>();
  mocks.build.mockReturnValueOnce(payload.promise);
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let old!: Promise<void>;
  act(() => { old = result.current.refresh(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce()); });
  rerender({ owner: "owner-b" });
  mocks.fetch.mockResolvedValueOnce({ success: true, data: { enabled: false } });
  let next!: Promise<void>;
  act(() => { next = result.current.refresh(); });
  try {
    await act(async () => { await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2), { timeout: 200 }); });
    expect(result.current.enabled).toBe(false);
  } finally {
    await act(async () => { payload.resolve({ focus_seconds_today: 1800 }); await old; await next; });
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(result.current.enabled).toBe(false);
});

it("ignores a completed old publication response after the owner changes", async () => {
  const published = deferred<{ success: boolean }>();
  mocks.publish.mockReturnValueOnce(published.promise);
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let task!: Promise<boolean>;
  act(() => { task = result.current.enable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce()); });
  rerender({ owner: "owner-b" });
  await act(async () => { published.resolve({ success: true }); expect(await task).toBe(false); });
  expect(result.current.enabled).toBeNull();
  expect(result.current.error).toBeNull();
});

it("never reads or writes a card while signed out, including saved callbacks", async () => {
  const { result, rerender } = renderHook(({ owner }: { owner: string | null }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" as string | null } });
  const old = result.current;
  rerender({ owner: null });
  await act(async () => {
    await result.current.refresh(); expect(await result.current.enable()).toBe(false);
    await result.current.disable(); await result.current.setDetailFlag("shareHourlyPattern", true);
    expect(await old.enable()).toBe(false); await old.disable();
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.flags).not.toHaveBeenCalled();
  expect(mocks.enabled).not.toHaveBeenCalled();
});

it("preserves A's submitted-write barrier when returning through B before deletion refresh", async () => {
  const posted = deferred<void>();
  const server = { focus: 1800 };
  mocks.publish.mockImplementationOnce(async () => { await posted.promise; server.focus = 1800; return { success: true }; });
  mocks.refresh.mockImplementation(async (payload: { focus_seconds_today: number }) => { server.focus = payload.focus_seconds_today; return { success: true }; });
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let enabling!: Promise<boolean>; act(() => { enabling = result.current.enable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce()); });
  rerender({ owner: "owner-b" }); rerender({ owner: "owner-a" });
  mocks.build.mockResolvedValue({ focus_seconds_today: 0 });
  let refresh!: Promise<void>; act(() => { refresh = result.current.refresh(); });
  try {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.fetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => { posted.resolve(); await enabling; await refresh; });
  }
  expect(server.focus).toBe(0);
});

it("withdraws consent immediately and again after A's earlier submitted publication settles", async () => {
  const posted = deferred<void>();
  const server = { enabled: true };
  mocks.publish.mockImplementationOnce(async () => { await posted.promise; server.enabled = true; return { success: true }; });
  mocks.enabled.mockImplementation(async (enabled: boolean) => { server.enabled = enabled; return { success: true }; });
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let enabling!: Promise<boolean>; act(() => { enabling = result.current.enable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce()); });
  rerender({ owner: "owner-b" }); rerender({ owner: "owner-a" });
  let disabling!: Promise<void>; act(() => { disabling = result.current.disable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.enabled).toHaveBeenCalled()); });
  expect(server.enabled).toBe(false);
  await act(async () => { posted.resolve(); await enabling; await disabling; });
  expect(server.enabled).toBe(false);
  expect(result.current.enabled).toBe(false);
});

it("retries the originating owner's unfinished withdrawal after signing back in", async () => {
  const posted = deferred<void>();
  const server = { enabled: true };
  let authOwner = "owner-a";
  mocks.publish.mockImplementationOnce(async () => { await posted.promise; server.enabled = true; return { success: true }; });
  mocks.enabled.mockImplementation(async (enabled: boolean, _client: unknown, expected: string) => {
    if (authOwner !== expected) return { success: false, error: "Account changed" };
    server.enabled = enabled; return { success: true };
  });
  mocks.fetch.mockImplementation(async () => ({ success: true, data: { enabled: server.enabled } }));
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let enabling!: Promise<boolean>; act(() => { enabling = result.current.enable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce()); });
  let disabling!: Promise<void>; act(() => { disabling = result.current.disable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.enabled).toHaveBeenCalled()); });
  authOwner = "owner-b"; rerender({ owner: "owner-b" });
  await act(async () => { posted.resolve(); await enabling; await disabling; });
  authOwner = "owner-a"; rerender({ owner: "owner-a" });
  await act(async () => { await result.current.refresh(); });
  expect(server.enabled).toBe(false); expect(result.current.enabled).toBe(false);
});

it("retains a later explicit enable when its successful response follows an account switch", async () => {
  const posted = deferred<void>(); const server = { enabled: true };
  mocks.enabled.mockResolvedValueOnce({ success: false, error: "Offline" }).mockImplementation(async (enabled: boolean) => { server.enabled = enabled; return { success: true }; });
  mocks.fetch.mockImplementation(async () => ({ success: true, data: { enabled: server.enabled } }));
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  await act(async () => { await result.current.disable(); });
  mocks.publish.mockImplementationOnce(async () => { await posted.promise; server.enabled = true; return { success: true }; });
  let enabling!: Promise<boolean>; act(() => { enabling = result.current.enable(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce()); });
  rerender({ owner: "owner-b" });
  await act(async () => { posted.resolve(); await enabling; });
  rerender({ owner: "owner-a" });
  await act(async () => { await result.current.refresh(); });
  expect(server.enabled).toBe(true); expect(result.current.enabled).toBe(true);
  expect(mocks.enabled).toHaveBeenCalledOnce();
});

it.each(["detail", "enable"] as const)("orders a returned owner's %s after an earlier off-card detail write", async action => {
  const posted = deferred<void>();
  const server = { category: false };
  mocks.flags.mockImplementation(async (flags: { shareCategoryBreakdown: boolean }) => {
    if (flags.shareCategoryBreakdown) await posted.promise;
    server.category = flags.shareCategoryBreakdown;
    return { success: true };
  });
  mocks.build.mockImplementation(async (flags: { shareCategoryBreakdown: boolean }) => ({
    focus_seconds_today: 1800, share_category_breakdown: flags.shareCategoryBreakdown,
  }));
  mocks.publish.mockImplementation(async (payload: { share_category_breakdown: boolean }) => {
    server.category = payload.share_category_breakdown;
    return { success: true };
  });
  const { result, rerender } = renderHook(({ owner }) => useFocusCard({ ...input, userId: owner }), { initialProps: { owner: "owner-a" } });
  let old!: Promise<void>; act(() => { old = result.current.setDetailFlag("shareCategoryBreakdown", true); });
  await act(async () => { await vi.waitFor(() => expect(mocks.flags).toHaveBeenCalledOnce()); });
  rerender({ owner: "owner-b" }); rerender({ owner: "owner-a" });
  let next!: Promise<unknown>;
  act(() => { next = action === "detail" ? result.current.setDetailFlag("shareCategoryBreakdown", false) : result.current.enable(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const writesBeforeOldSettles = mocks.flags.mock.calls.length + mocks.publish.mock.calls.length;
  await act(async () => { posted.resolve(); await old; await next; });
  expect(server.category).toBe(false);
  expect(writesBeforeOldSettles).toBe(1);
});

it.each(["off-detail", "live-detail", "disable"] as const)("does not revive a stale read after an explicit %s", async action => {
  const old = { enabled: action !== "off-detail", detailFlags: { shareCategoryBreakdown: true, shareHourlyPattern: true } };
  const pending = deferred<{success: boolean; data: typeof old}>();
  mocks.fetch.mockResolvedValueOnce({ success: true, data: old });
  mocks.build.mockImplementation(async (flags: {shareCategoryBreakdown: boolean}) => ({ focus_seconds_today: 1800, share_category_breakdown: flags.shareCategoryBreakdown }));
  const server = { category: true };
  mocks.publish.mockImplementation(async (payload: {share_category_breakdown: boolean}) => { server.category = payload.share_category_breakdown; return { success: true }; });
  const { result } = renderHook(() => useFocusCard({ ...input, userId: "owner-a" }));
  await act(async () => { await result.current.refresh(); });
  mocks.fetch.mockReturnValueOnce(pending.promise);
  let refresh!: Promise<void>; act(() => { refresh = result.current.refresh(); });
  await act(async () => { await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2)); });
  await act(async () => {
    if (action === "disable") await result.current.disable();
    else await result.current.setDetailFlag("shareCategoryBreakdown", false);
  });
  await act(async () => { pending.resolve({ success: true, data: old }); await refresh; });
  if (action === "disable") {
    expect(result.current.enabled).toBe(false);
  } else {
    expect(result.current.detailFlags?.shareCategoryBreakdown).toBe(false);
    await act(async () => { expect(await result.current.enable()).toBe(true); });
    expect(server.category).toBe(false);
  }
});
