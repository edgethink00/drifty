// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchTeamPresence: vi.fn() }));
vi.mock("./teamSharingService", () => ({ fetchTeamPresence: mocks.fetchTeamPresence }));

import { TEAM_PRESENCE_POLL_MS, useTeamPresence, type UseTeamPresenceInput } from "./useTeamPresence";

const row = { member_key: "k1", tracking: true, last_seen_at: "2026-10-26T01:00:00Z" };
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetchTeamPresence.mockReset();
  mocks.fetchTeamPresence.mockResolvedValue({ success: true, error: null, data: [row] });
});
afterEach(() => vi.useRealTimers());

describe("useTeamPresence", () => {
  it("reads who is recording while the page is open and asks again every minute", async () => {
    const { result } = renderHook(() => useTeamPresence({ enabled: true, organizationId: "org-1" }));
    await settle();
    expect(result.current).toEqual([row]);
    expect(mocks.fetchTeamPresence).toHaveBeenCalledWith({ organization_id: "org-1" });
    mocks.fetchTeamPresence.mockResolvedValue({ success: false, error: "offline", reason: "remote_error" });
    await act(async () => { vi.advanceTimersByTime(TEAM_PRESENCE_POLL_MS); });
    await settle();
    expect(mocks.fetchTeamPresence).toHaveBeenCalledTimes(2);
    // A failed read keeps the last answer.
    expect(result.current).toEqual([row]);
  });

  it("asks nothing when the seat or the hours do not show it, and starts empty for another team", async () => {
    const { result, rerender } = renderHook((props: UseTeamPresenceInput) => useTeamPresence(props), { initialProps: { enabled: false, organizationId: "org-1" } });
    await settle();
    expect(mocks.fetchTeamPresence).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);

    rerender({ enabled: true, organizationId: "org-1" });
    await settle();
    expect(result.current).toEqual([row]);
    mocks.fetchTeamPresence.mockReturnValue(new Promise(() => undefined));
    rerender({ enabled: true, organizationId: "org-2" });
    expect(result.current).toEqual([]);
    rerender({ enabled: false, organizationId: "org-2" });
    expect(result.current).toEqual([]);
  });
});
