// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./cliPilot", async importOriginal => ({
  ...await importOriginal<typeof import("./cliPilot")>(), requestCliPilotAssignment: mocks.request,
}));
const completion = vi.hoisted(() => ({ done: true }));
vi.mock("./onboardingCompletion", () => ({ hasCompletedUserOnboarding: () => completion.done }));
import { useCliPilot } from "./useCliPilot";

afterEach(() => { localStorage.clear(); mocks.request.mockReset(); completion.done = true; vi.unstubAllGlobals(); });
it("asks for a new slot on a Mac but only restores an existing one on Windows", async () => {
  completion.done = false;
  mocks.request.mockResolvedValue(null);
  renderHook(() => useCliPilot("mac-user", true, false));
  await act(async () => {});
  expect(mocks.request).toHaveBeenLastCalledWith(expect.any(AbortSignal), "assign");
  vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
  renderHook(() => useCliPilot("windows-user", true, false));
  await act(async () => {});
  expect(mocks.request).toHaveBeenLastCalledWith(expect.any(AbortSignal), "read");
});
it("retains previously admitted CLI choices when Settings restoration is offline", async () => {
  localStorage.setItem("drifty.cliPilot.v1:owner", "cli");
  mocks.request.mockResolvedValue(null);
  const { result } = renderHook(() => useCliPilot("owner", true, false, false));
  await act(async () => {});
  expect(mocks.request).toHaveBeenCalledWith(expect.any(AbortSignal), "read");
  expect(result.current).toBe("cli");
});
it("does not carry another account's cached pilot access across an account change", async () => {
  localStorage.setItem("drifty.cliPilot.v1:first", "cli");
  mocks.request.mockResolvedValue(null);
  const { result, rerender } = renderHook(({ userId }) => useCliPilot(userId, true, false, false), { initialProps: { userId: "first" } });
  await act(async () => {});
  expect(result.current).toBe("cli");
  rerender({ userId: "second" });
  await act(async () => {});
  expect(result.current).toBeNull();
});
