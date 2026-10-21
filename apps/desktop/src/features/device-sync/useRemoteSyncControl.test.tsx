// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeRemoteSyncControl, dismissRemoteSyncControl, pollRemoteSyncControl } from "./deviceSyncApi";
import { markRemoteSyncDismissal, readRemoteSyncDismissal } from "./remoteSyncDismissal";
import { useRemoteSyncControl } from "./useRemoteSyncControl";

vi.mock("../../lib/api/previewData", () => ({ shouldUsePreviewData: () => false }));
vi.mock("./deviceSyncApi", () => ({
  pollRemoteSyncControl: vi.fn(), consumeRemoteSyncControl: vi.fn(), dismissRemoteSyncControl: vi.fn(),
}));

const pending = "61111111-1111-4111-8111-111111111111";
describe("remote sync receiver", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(pollRemoteSyncControl).mockReset().mockResolvedValue({ requestId: pending });
    vi.mocked(consumeRemoteSyncControl).mockReset().mockResolvedValue({ accepted: true, syncGeneration: 3 });
    vi.mocked(dismissRemoteSyncControl).mockReset().mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("listens with uploads OFF and enables only after one-shot server receipt", async () => {
    const onEnable = vi.fn(async () => {});
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable }));
    await waitFor(() => expect(onEnable).toHaveBeenCalledWith(3, expect.any(Function)));
    expect(pollRemoteSyncControl).toHaveBeenCalledWith("a", false);
    expect(consumeRemoteSyncControl).toHaveBeenCalledWith("a", pending);
  });
  it("never listens without the account and eligibility gate", async () => {
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: false, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable: vi.fn() }));
    await act(async () => {});
    expect(pollRemoteSyncControl).not.toHaveBeenCalled();
  });
  it("does not apply a lost race, rejected receipt or malformed generation", async () => {
    vi.mocked(consumeRemoteSyncControl).mockResolvedValueOnce({ accepted: false });
    const onEnable = vi.fn(async () => {});
    const { unmount } = renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable }));
    await waitFor(() => expect(consumeRemoteSyncControl).toHaveBeenCalled());
    expect(onEnable).not.toHaveBeenCalled(); unmount();
    vi.mocked(consumeRemoteSyncControl).mockResolvedValueOnce({ accepted: true, syncGeneration: 0 });
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable }));
    await waitFor(() => expect(consumeRemoteSyncControl).toHaveBeenCalledTimes(2));
    expect(onEnable).not.toHaveBeenCalled();
  });
  it("local OFF during an in-flight receipt wins, even when the visible toggle was already off", async () => {
    let finish!: (value: { accepted: boolean; syncGeneration: number }) => void;
    vi.mocked(consumeRemoteSyncControl).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let revision = 0;
    const onEnable = vi.fn(async () => {});
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => revision, onEnable }));
    await waitFor(() => expect(consumeRemoteSyncControl).toHaveBeenCalled());
    revision += 1; markRemoteSyncDismissal("a");
    await act(async () => finish({ accepted: true, syncGeneration: 3 }));
    expect(onEnable).not.toHaveBeenCalled();
  });
  it("an offline OFF is persisted and dismisses unseen requests before listening again", async () => {
    markRemoteSyncDismissal("a");
    const onEnable = vi.fn(async () => {});
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable }));
    await waitFor(() => expect(dismissRemoteSyncControl).toHaveBeenCalledWith("a", false));
    await waitFor(() => expect(readRemoteSyncDismissal("a")).toBeNull());
    expect(pollRemoteSyncControl).not.toHaveBeenCalled();
    expect(onEnable).not.toHaveBeenCalled();
  });
  it("retains a newer OFF marker when a prior dismissal returns late", async () => {
    let finish!: () => void;
    vi.mocked(dismissRemoteSyncControl).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}); }));
    markRemoteSyncDismissal("a");
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable: vi.fn() }));
    await waitFor(() => expect(dismissRemoteSyncControl).toHaveBeenCalled());
    markRemoteSyncDismissal("a"); const newer = readRemoteSyncDismissal("a");
    await act(async () => finish());
    expect(readRemoteSyncDismissal("a")).toBe(newer);
  });
  it("drops a previous account's response and retires its pending consent", async () => {
    let finish!: (value: { requestId: string }) => void;
    vi.mocked(pollRemoteSyncControl).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const onEnable = vi.fn(async () => {});
    const { rerender } = renderHook(({ accountId, active }) => useRemoteSyncControl({ onDisable: vi.fn(), active, accountId, enabled: false, getLocalRevision: () => 0, onEnable }), { initialProps: { accountId: "a", active: true } });
    await waitFor(() => expect(pollRemoteSyncControl).toHaveBeenCalled());
    rerender({ accountId: "b", active: false });
    await act(async () => finish({ requestId: pending }));
    expect(consumeRemoteSyncControl).not.toHaveBeenCalled();
    expect(onEnable).not.toHaveBeenCalled();
    expect(readRemoteSyncDismissal("a")).not.toBeNull();
    expect(readRemoteSyncDismissal("b")).toBeNull();
  });
  it("keeps uploads off when an older server cannot handle the receiver", async () => {
    vi.mocked(pollRemoteSyncControl).mockRejectedValue(new Error("unsupported action"));
    const onEnable = vi.fn(async () => {});
    renderHook(() => useRemoteSyncControl({ onDisable: vi.fn(), active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable }));
    await waitFor(() => expect(pollRemoteSyncControl).toHaveBeenCalled());
    expect(onEnable).not.toHaveBeenCalled();
  });
  it("applies an iPhone OFF while uploading, without receiving anything", async () => {
    vi.mocked(pollRemoteSyncControl).mockResolvedValue({ requestId: null, disable: true });
    const onDisable = vi.fn();
    renderHook(() => useRemoteSyncControl({ active: true, accountId: "a", enabled: true, getLocalRevision: () => 0, onEnable: vi.fn(), onDisable }));
    await waitFor(() => expect(onDisable).toHaveBeenCalledTimes(1));
    expect(pollRemoteSyncControl).toHaveBeenCalledWith("a", true);
    expect(consumeRemoteSyncControl).not.toHaveBeenCalled();
  });
  it("ignores an iPhone OFF when uploads are already off, so the next poll reports OFF", async () => {
    vi.mocked(pollRemoteSyncControl).mockResolvedValue({ requestId: null, disable: true });
    const onDisable = vi.fn();
    renderHook(() => useRemoteSyncControl({ active: true, accountId: "a", enabled: false, getLocalRevision: () => 0, onEnable: vi.fn(), onDisable }));
    await waitFor(() => expect(pollRemoteSyncControl).toHaveBeenCalledWith("a", false));
    expect(onDisable).not.toHaveBeenCalled();
  });
  it("receives newer iPhone consent before an older OFF", async () => {
    vi.mocked(pollRemoteSyncControl).mockResolvedValue({ requestId: pending, disable: true });
    const onEnable = vi.fn(async () => {});
    const onDisable = vi.fn();
    renderHook(() => useRemoteSyncControl({ active: true, accountId: "a", enabled: true, getLocalRevision: () => 0, onEnable, onDisable }));
    await waitFor(() => expect(onEnable).toHaveBeenCalledWith(3, expect.any(Function)));
    expect(onDisable).not.toHaveBeenCalled();
  });
});
