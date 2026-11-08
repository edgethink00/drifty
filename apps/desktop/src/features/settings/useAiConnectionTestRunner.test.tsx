// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { AUTO_CONNECTION_TEST_SETTLE_MS, useAiConnectionTestRunner } from "./useAiConnectionTestRunner";
import { DEFAULT_LOCAL_AI_SETUP, type LocalAiSetupState } from "./localAiSetup";
import type { AiConnectionTestResult } from "./aiConnectionTest";

const { testLocal, journal } = vi.hoisted(() => ({ testLocal: vi.fn(), journal: vi.fn() }));
vi.mock("./aiConnectionTest", () => ({ testLocalAiConnection: testLocal }));
vi.mock("./cloudAiConnectionTest", () => ({ testCloudAiConnection: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", () => ({ capturePostHogEvent: vi.fn(), toAnalyticsErrorKind: vi.fn() }));
vi.mock("../../lib/diagnostics/supportJournal", () => ({ recordSupportJournalEvent: journal }));
const setup = { ...DEFAULT_LOCAL_AI_SETUP, provider: "self_hosted" as const, selfHostedBaseUrl: "http://localhost:11434/v1", selfHostedModel: "first" };

beforeEach(() => { testLocal.mockReset(); journal.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
describe("background probe journal", () => {
  it("keeps a failed automatic probe in the on-device support journal with its endpoint error kind", async () => {
    testLocal.mockResolvedValue({
      kind: "error",
      issueKind: "provider",
      message: "The endpoint returned a web page instead of an API response. Check the base URL; it usually ends in /v1.",
      detail: { httpStatus: 200, responseKind: "html" },
    });
    renderHook(() => useAiConnectionTestRunner({ localAiSetup: setup, onLocalAiConnectionTestResult: vi.fn() }));
    await act(async () => {});

    expect(journal).toHaveBeenCalledWith("ai_setup_action", {
      action: "test_connection",
      provider_kind: "custom",
      result: "error",
      error_kind: "configuration",
    });
  });
});
describe("automatic probe while editing", () => {
  it("sends one probe for a typed model name once the edit settles", async () => {
    vi.useFakeTimers();
    testLocal.mockResolvedValue({ kind: "success", message: "Connected in 14 ms." });
    const { rerender } = renderHook(({ current }) => useAiConnectionTestRunner({ localAiSetup: current, onLocalAiConnectionTestResult: vi.fn() }), { initialProps: { current: setup } });
    expect(testLocal).toHaveBeenCalledTimes(1);
    await act(async () => {});
    for (const model of ["q", "qw", "qwen3.5", "qwen3.5:0.8b"]) {
      rerender({ current: { ...setup, selfHostedModel: model } });
      await act(async () => { vi.advanceTimersByTime(AUTO_CONNECTION_TEST_SETTLE_MS - 1); });
    }
    expect(testLocal).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(testLocal).toHaveBeenCalledTimes(2);
    expect((testLocal.mock.calls[1]![0] as typeof setup).selfHostedModel).toBe("qwen3.5:0.8b");
  });

  it("probes at once when a paused probe is released or the provider changes", async () => {
    vi.useFakeTimers();
    testLocal.mockResolvedValue({ kind: "success", message: "Connected in 14 ms." });
    const initial: { current: LocalAiSetupState; paused: boolean } = { current: setup, paused: true };
    const openaiSetup: LocalAiSetupState = { ...DEFAULT_LOCAL_AI_SETUP, provider: "openai", openaiApiKey: "sk-test", openaiModel: "gpt-test" };
    const { rerender } = renderHook(({ current, paused }) => useAiConnectionTestRunner({ localAiSetup: current, onLocalAiConnectionTestResult: vi.fn(), autoTestPaused: paused }), { initialProps: initial });
    expect(testLocal).not.toHaveBeenCalled();
    rerender({ current: setup, paused: false });
    expect(testLocal).toHaveBeenCalledTimes(1);
    await act(async () => {});
    rerender({ current: openaiSetup, paused: false });
    expect(testLocal).toHaveBeenCalledTimes(2);
  });
});
describe("connection probe lifetime", () => {
  it("finishes one automatic probe across StrictMode effect remounts", async () => {
    let finish!: (value: AiConnectionTestResult) => void;
    testLocal.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onResult = vi.fn();
    const { result } = renderHook(() => useAiConnectionTestRunner({ localAiSetup: setup, onLocalAiConnectionTestResult: onResult }), { wrapper: StrictMode });
    expect(testLocal).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ kind: "success", message: "Connected in 14 ms." }); });
    expect(result.current.running).toBe(false);
    expect(result.current.result?.kind).toBe("success");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("coalesces repeated clicks and rejects a late result after switching away and back", async () => {
    let finish!: (value: AiConnectionTestResult) => void;
    testLocal.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onResult = vi.fn();
    const { result, rerender } = renderHook(({ current }) => useAiConnectionTestRunner({ localAiSetup: current, onLocalAiConnectionTestResult: onResult, autoTestPaused: true }), { initialProps: { current: setup } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(); void result.current.run(); });
    expect(testLocal).toHaveBeenCalledTimes(1);
    const canSend = testLocal.mock.calls[0]![1] as () => boolean;
    expect(canSend()).toBe(true);
    rerender({ current: { ...setup, selfHostedModel: "second" } });
    rerender({ current: setup });
    expect(canSend()).toBe(false);
    await act(async () => { finish({ kind: "success", message: "Connected in 999 ms." }); await pending; });
    expect(result.current.result).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
  });

  it("clears a completed result synchronously when the model changes", async () => {
    testLocal.mockResolvedValue({ kind: "success", message: "Connected in 14 ms." });
    const { result, rerender } = renderHook(({ current }) => useAiConnectionTestRunner({ localAiSetup: current, onLocalAiConnectionTestResult: vi.fn(), autoTestPaused: true }), { initialProps: { current: setup } });
    await act(async () => { await result.current.run(); });
    expect(result.current.result?.kind).toBe("success");
    rerender({ current: { ...setup, selfHostedModel: "second" } });
    expect(result.current.result).toBeNull();
  });

  it("recovers from a rejected transport and ignores completion after unmount", async () => {
    testLocal.mockRejectedValueOnce(new Error("private detail"));
    const onResult = vi.fn();
    const { result, unmount } = renderHook(() => useAiConnectionTestRunner({ localAiSetup: setup, onLocalAiConnectionTestResult: onResult, autoTestPaused: true }));
    await act(async () => { await result.current.run(); });
    expect(result.current.result).toEqual({ kind: "error", issueKind: "provider", message: "Connection test failed." });
    expect(result.current.running).toBe(false);
    let finish!: (value: AiConnectionTestResult) => void;
    testLocal.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(); });
    unmount();
    await act(async () => { finish({ kind: "success", message: "Connected in 12 ms." }); await pending; });
    expect(onResult).not.toHaveBeenCalled();
  });
});
