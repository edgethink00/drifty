// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useAiConnectionTestRunner } from "./useAiConnectionTestRunner";
import { DEFAULT_LOCAL_AI_SETUP } from "./localAiSetup";
import type { AiConnectionTestResult } from "./aiConnectionTest";

const { testLocal } = vi.hoisted(() => ({ testLocal: vi.fn() }));
vi.mock("./aiConnectionTest", () => ({ testLocalAiConnection: testLocal }));
vi.mock("./cloudAiConnectionTest", () => ({ testCloudAiConnection: vi.fn() }));
vi.mock("../../lib/analytics/posthogClient", () => ({ capturePostHogEvent: vi.fn(), toAnalyticsErrorKind: vi.fn() }));
const setup = { ...DEFAULT_LOCAL_AI_SETUP, provider: "self_hosted" as const, selfHostedBaseUrl: "http://localhost:11434/v1", selfHostedModel: "first" };

beforeEach(() => { testLocal.mockReset(); });
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
    rerender({ current: { ...setup, selfHostedModel: "second" } });
    rerender({ current: setup });
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
