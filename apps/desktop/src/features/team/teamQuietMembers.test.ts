// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ totals: vi.fn() }));
vi.mock("./teamSharingService", () => ({ fetchTeamTotals: mocks.totals }));

import { notifyTeamTimeShared } from "../../lib/teamProjectMirrorEvents";
import { quietTeamMemberCount, teamQuietWindow, useTeamQuietMembers } from "./teamQuietMembers";

const now = Date.parse("2026-11-07T03:00:00Z");
const roster = [
  { member_key: "k-owner", joined_at: "2026-07-07T14:41:18Z" },
  { member_key: "k-ana", joined_at: "2026-10-09T11:22:11Z" },
  { member_key: "k-ben", joined_at: "2026-10-20T00:00:00Z" },
  { member_key: "k-new", joined_at: "2026-11-06T20:00:00Z" },
];

describe("quiet teammates", () => {
  it("counts people past their first day with no shared project time or focus in the window", () => {
    expect(quietTeamMemberCount(roster, [
      { row_kind: "member_project", member_key: "k-owner", seconds: 3600 },
      { row_kind: "member_focus", member_key: "k-ben", seconds: 0 },
      // Team totals name nobody, and someone who joined hours ago is not counted yet.
      { row_kind: "team_project", member_key: null, seconds: 3600 },
    ], now)).toBe(2);
    expect(quietTeamMemberCount(roster, [{ row_kind: "member_focus", member_key: "k-ana", seconds: 60 }, { row_kind: "member_project", member_key: "k-ben", seconds: 60 }, { row_kind: "member_project", member_key: "k-owner", seconds: 60 }], now)).toBe(0);
  });

  it("reads the last seven logical days, today included", () => {
    expect(teamQuietWindow(now, 0)).toEqual({ start_date: "2026-11-01", end_date: "2026-11-07" });
    // 03:00 UTC is 12:00 in Seoul; a day starting at 04:00 still makes it the 7th.
    expect(teamQuietWindow(now, 240)).toEqual({ start_date: "2026-11-01", end_date: "2026-11-07" });
  });
});

// The hook: only for an enabled seat with a roster, read again when this person's time went up.
describe("useTeamQuietMembers", () => {
  it("reads the last seven days for an enabled seat and again after a share, and nothing otherwise", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    mocks.totals.mockResolvedValue({ success: true, error: null, data: [{ row_kind: "member_project", member_key: "k-owner", seconds: 60 }] });
    const off = renderHook(() => useTeamQuietMembers({ enabled: false, organizationId: "org", roster, startOfDayMinutes: 0 }));
    expect(off.result.current).toBeNull();
    expect(mocks.totals).not.toHaveBeenCalled();
    off.unmount();

    const { result } = renderHook(() => useTeamQuietMembers({ enabled: true, organizationId: "org", roster, startOfDayMinutes: 0 }));
    await waitFor(() => expect(result.current).toBe(2));
    expect(mocks.totals).toHaveBeenCalledTimes(1);
    expect(mocks.totals.mock.calls[0]![0]).toMatchObject({ organization_id: "org" });
    mocks.totals.mockResolvedValue({ success: true, error: null, data: ["k-owner", "k-ana", "k-ben"].map((key) => ({ row_kind: "member_focus", member_key: key, seconds: 60 })) });
    act(() => notifyTeamTimeShared("other-org"));
    act(() => notifyTeamTimeShared("org"));
    await waitFor(() => expect(result.current).toBe(0));
    expect(mocks.totals).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

