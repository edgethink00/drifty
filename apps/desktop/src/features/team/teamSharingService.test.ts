import { describe, expect, it } from "vitest";

import {
  deleteTeamServerBoard,
  fetchTeamServerBoards,
  fetchTeamServerPolicy,
  fetchTeamTotals,
  publishTeamFocusDays,
  saveTeamServerBoard,
  saveTeamServerPolicy,
  setTeamMemberRole,
} from "./teamSharingService";
import { createClient, expectLastRpcCall, expectNoForbiddenPayloadKeys, expectRecord, organizationId } from "./teamServiceTestClient";

describe("team sharing on the server", () => {
  it("reads the stored policy and the caller's seat, and a team without one as the beta", async () => {
    const client = createClient();
    client.setRpcResponse("get_organization_team_policy", {
      data: [{
        organization_id: organizationId, is_set: true, projects_level: "member_daily", tasks_level: "off", focus_level: "team", member_summary: true,
        tracking_policy: "managed", schedule_days: [1, 2, 3, 4, 5], schedule_start_minute: 540, schedule_end_minute: 1080, schedule_timezone: "Asia/Seoul",
        schedule_clock: "local", seat: "manager", manager_access: "detail", manager_may_narrow: true, updated_at: "2026-10-21T09:00:00Z",
      }],
      error: null,
    });
    const result = await fetchTeamServerPolicy({ organization_id: organizationId }, client);
    expect(result.success && result.data).toEqual({
      organization_id: organizationId,
      policy: { projects: "member_daily", tasks: "off", focus: "team", memberSummary: true },
      tracking_policy: "managed",
      schedule: { days: [1, 2, 3, 4, 5], start_minute: 540, end_minute: 1080, timezone: "Asia/Seoul", clock: "local" },
      seat: "manager",
      manager_access: "detail",
      manager_may_narrow: true,
      updated_at: "2026-10-21T09:00:00Z",
    });

    client.setRpcResponse("get_organization_team_policy", { data: [{ organization_id: organizationId, is_set: false, seat: "member", manager_access: "totals" }], error: null });
    const legacy = await fetchTeamServerPolicy({ organization_id: organizationId }, client);
    expect(legacy.success && legacy.data?.policy).toBeNull();
    expect(legacy.success && legacy.data?.seat).toBe("member");
  });

  it("saves every item's level with the hours, and refuses hours that cannot exist before calling the server", async () => {
    const client = createClient();
    await saveTeamServerPolicy({
      organization_id: organizationId,
      policy: { projects: "hourly", tasks: "member_daily", focus: "off", memberSummary: false },
      tracking_policy: "managed",
      schedule: { days: [5, 1, 3, 1], start_minute: 480, end_minute: 1020, timezone: "Asia/Seoul", clock: "team" },
    }, client);
    expect(expectLastRpcCall(client)).toEqual({
      procedure: "set_organization_team_policy",
      args: {
        input_organization_id: organizationId,
        input_projects_level: "hourly",
        input_tasks_level: "member_daily",
        input_focus_level: "off",
        input_member_summary: false,
        input_tracking_policy: "managed",
        input_schedule_days: [1, 3, 5],
        input_schedule_start_minute: 480,
        input_schedule_end_minute: 1020,
        input_schedule_timezone: "Asia/Seoul",
        input_schedule_clock: "team",
      },
    });
    const before = client.rpcCalls.length;
    const refused = await saveTeamServerPolicy({
      organization_id: organizationId,
      policy: { projects: "team", tasks: "off", focus: "off", memberSummary: true },
      schedule: { days: [1], start_minute: 1000, end_minute: 900, timezone: "UTC", clock: "team" },
    }, client);
    expect(refused.success).toBe(false);
    expect(client.rpcCalls.length).toBe(before);
  });

  it("names roles by the member's opaque key", async () => {
    const client = createClient();
    client.setRpcResponse("set_organization_member_role", { data: [{ member_key: "k1", membership_role: "manager", manager_access: "detail", manager_may_narrow: true }], error: null });
    const result = await setTeamMemberRole({ organization_id: organizationId, member_key: "k1", role: "manager", manager_access: "detail", manager_may_narrow: true }, client);
    expect(result.success && result.data).toEqual({ member_key: "k1", membership_role: "manager", manager_access: "detail", manager_may_narrow: true });
    expect(expectRecord(expectLastRpcCall(client).args)).toEqual({ input_organization_id: organizationId, input_member_key: "k1", input_role: "manager", input_manager_access: "detail", input_manager_may_narrow: true });
  });

  it("reads totals as the server cut them, without account ids, and checks the window first", async () => {
    const client = createClient();
    client.setRpcResponse("get_organization_team_totals", {
      data: [
        { row_kind: "team_project", organization_project_id: "p1", member_key: null, member_display_name: null, is_self: false, activity_date: "2026-10-21", seconds: "21600" },
        { row_kind: "member_focus", organization_project_id: null, member_key: "k1", member_display_name: "Ana", is_self: true, activity_date: "2026-10-21T00:00:00", seconds: 1800, app_user_id: "must-not-leak" },
      ],
      error: null,
    });
    const result = await fetchTeamTotals({ organization_id: organizationId, start_date: "2026-10-15", end_date: "2026-10-21" }, client);
    expect(result.success && result.data).toEqual([
      { row_kind: "team_project", organization_project_id: "p1", member_key: null, member_display_name: null, is_self: false, activity_date: "2026-10-21", seconds: 21600 },
      { row_kind: "member_focus", organization_project_id: null, member_key: "k1", member_display_name: "Ana", is_self: true, activity_date: "2026-10-21", seconds: 1800 },
    ]);
    const before = client.rpcCalls.length;
    expect((await fetchTeamTotals({ organization_id: organizationId, start_date: "2026-10-21", end_date: "2026-10-15" }, client)).success).toBe(false);
    expect(client.rpcCalls.length).toBe(before);
  });

  it("publishes focus only as day totals inside the window, at most a day each", async () => {
    const client = createClient();
    await publishTeamFocusDays({
      organization_id: organizationId,
      display_name: "Ana",
      window_start_date: "2026-10-15",
      window_end_date: "2026-10-21",
      entries: [
        { activity_date: "2026-10-14", seconds: 600 },
        { activity_date: "2026-10-20", seconds: 99999 },
        { activity_date: "2026-10-21", seconds: 0 },
        { activity_date: "2026-10-21", seconds: 1800.4 },
      ],
    }, client);
    const payload = expectRecord(expectLastRpcCall(client).args);
    expect(payload.input_entries).toEqual([{ activity_date: "2026-10-20", seconds: 86400 }, { activity_date: "2026-10-21", seconds: 1800 }]);
    expectNoForbiddenPayloadKeys(payload);
  });

  it("keeps boards to their layout, within the server's limits", async () => {
    const client = createClient();
    client.setRpcResponse("get_organization_dashboards", {
      data: [{ dashboard_id: "b1", name: "Weekly", seq: 2, visibility: "leaders", grid: "calibrated", items: [{ key: "n", widget: "numbers", size: "4x1" }], is_own: false, owner_member_key: "k2", updated_at: null }],
      error: null,
    });
    const boards = await fetchTeamServerBoards({ organization_id: organizationId }, client);
    expect(boards.success && boards.data[0]).toEqual({ dashboard_id: "b1", name: "Weekly", seq: 2, visibility: "leaders", grid: "calibrated", items: [{ key: "n", widget: "numbers", size: "4x1" }], is_own: false, owner_member_key: "k2", updated_at: null });

    await saveTeamServerBoard({ organization_id: organizationId, dashboard_id: null, name: "  ", seq: 0, visibility: "me", grid: "calibrated", items: [] }, client);
    expect(expectRecord(expectLastRpcCall(client).args)).toMatchObject({ input_dashboard_id: null, input_name: null, input_seq: 1 });
    const before = client.rpcCalls.length;
    const tooMany = await saveTeamServerBoard({ organization_id: organizationId, dashboard_id: null, name: null, seq: 1, visibility: "me", grid: "calibrated", items: Array.from({ length: 41 }, () => ({})) }, client);
    expect(tooMany.success).toBe(false);
    expect(client.rpcCalls.length).toBe(before);

    await deleteTeamServerBoard({ dashboard_id: "b1" }, client);
    expect(expectLastRpcCall(client)).toEqual({ procedure: "delete_organization_dashboard", args: { input_dashboard_id: "b1" } });
  });
});
