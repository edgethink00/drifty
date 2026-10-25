// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTeamInvitePreview } from "./useTeamInvitePreview";
import type { TeamInvitePreview, TeamResult } from "./teamTypes";
const mocks = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("./teamInvitePreviewService", () => ({ previewTeamInvite: mocks.preview }));
const reply = (name: string): TeamResult<TeamInvitePreview> => ({ success: true, error: null, data: {
  organizationId: name, organizationName: name, roleLabel: "Member", policyVersion: "a".repeat(32),
  policy: { projects: "team", tasks: "off", focus: "off", memberSummary: true }, trackingPolicy: "free", schedule: null,
} });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(350); });
beforeEach(() => { vi.useFakeTimers(); mocks.preview.mockReset(); });
afterEach(() => vi.useRealTimers());
it("ignores old responses and immediately withdraws a preview when the code changes", async () => {
  let resolveOld!: (value: TeamResult<TeamInvitePreview>) => void;
  mocks.preview.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(reply("B"));
  const { result, rerender } = renderHook(({ code }) => useTeamInvitePreview(code, true), { initialProps: { code: "A" } });
  await tick(); rerender({ code: "B" }); await tick();
  expect(result.current.preview?.organizationName).toBe("B");
  await act(async () => resolveOld(reply("A")));
  expect(result.current.preview?.organizationName).toBe("B");
  rerender({ code: "C" }); expect(result.current.preview).toBeNull(); expect(result.current.loading).toBe(true);
});
it("rechecks on retry and reopening; never queries a closed or empty form", async () => {
  mocks.preview.mockResolvedValue(reply("A"));
  const { result, rerender } = renderHook(({ enabled, code }) => useTeamInvitePreview(code, enabled), { initialProps: { enabled: false, code: "A" } });
  await tick(); expect(mocks.preview).not.toHaveBeenCalled();
  rerender({ enabled: true, code: "A" }); await tick();
  act(() => result.current.refresh()); expect(result.current.preview).toBeNull(); await tick();
  rerender({ enabled: false, code: "A" }); rerender({ enabled: true, code: "A" });
  expect(result.current.preview).toBeNull(); await tick(); expect(mocks.preview).toHaveBeenCalledTimes(3);
  rerender({ enabled: true, code: " " }); await tick(); expect(mocks.preview).toHaveBeenCalledTimes(3);
});
