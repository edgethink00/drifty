import type { ActivitySegment } from "@drifty/domain";
import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import type { AuthState } from "../auth/AuthContext";
import type { OwnTeam, TeamFocusSummaryRow, TeamInvite, TeamLiveStatusRow, TeamResult } from "./teamService";
import { useTeamController } from "./useTeamController";

export const signedInUser: NonNullable<AuthState["user"]> = {
  id: "user-1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-07-01T00:00:00.000Z", email: "alex@example.com",
};

export const sharedTeam = makeTeam({ focus_share_scope: "focus_only", focus_seconds: 7200, focus_score: 75, private_rank: 1 });
export const privateTeam = makeTeam({ focus_share_scope: "private", focus_seconds: 0, focus_score: 0, private_rank: null });

export const ownSummaryRow: TeamFocusSummaryRow = {
  organization_id: "team-1", organization_name: "Deep Work Crew", member_display_name: "Alex", role_label: "Owner",
  focus_share_scope: "focus_only", focus_seconds: 7200, focus_score: 75, private_rank: 1,
  window_start_date: "2026-06-26", window_end_date: "2026-07-02", updated_at: "2026-07-02T08:00:00.000Z",
};

export const teammateSummaryRow: TeamFocusSummaryRow = {
  ...ownSummaryRow, member_display_name: "Sam", role_label: "Member", focus_seconds: 3600, focus_score: 50, private_rank: 2,
};

export const liveStatusRow: TeamLiveStatusRow = {
  organization_id: "team-1",
  organization_name: "Deep Work Crew",
  member_display_name: "Alex",
  profile_avatar_url: "",
  role_label: "Owner",
  focus_share_scope: "focus_only",
  presence_state: "active_now",
  focus_seconds: 7200,
  focus_score: 75,
  window_start_date: "2026-06-26",
  window_end_date: "2026-07-02",
  last_shared_at: "2026-07-02T08:00:00.000Z",
};

export const pendingInvite: TeamInvite = {
  invite_id: "invite-1",
  organization_id: "team-1",
  organization_name: "Deep Work Crew",
  invite_code: "DRFT-ABCD-2345",
  invite_url: "https://drifty.so/app/team-invite?token=abcdefghijklmnopqrstuvwxyzABCDEFG_1234567890&code=DRFT-ABCD-2345",
  role_label: "Member",
  status: "pending",
  expires_at: "2026-07-09T00:00:00.000Z",
  created_at: "2026-07-02T08:00:00.000Z",
  updated_at: "2026-07-02T08:00:00.000Z",
};

export function ok<T>(data: T): TeamResult<T> {
  return { success: true, error: null, data };
}

export function fail(error: string): TeamResult<never> {
  return { success: false, error, reason: "remote_error" };
}

export function makeTeam(overrides: Partial<OwnTeam> = {}): OwnTeam {
  return {
    organization_id: "team-1", organization_name: "Deep Work Crew", member_display_name: "Alex", role_label: "Owner",
    focus_share_scope: "private", member_count: 2, focus_seconds: 0, focus_score: 0, private_rank: null,
    window_start_date: "2026-06-26", window_end_date: "2026-07-02", updated_at: "2026-07-02T08:00:00.000Z",
    ...overrides,
  };
}

export function makeActivity(overrides: Partial<ActivitySegment>): ActivitySegment {
  return {
    id: "activity-1", startedAt: "2026-07-01T10:00:00", endedAt: "2026-07-01T11:00:00",
    durationSeconds: 60 * 60, appName: "Code", platform: "macos", source: "manual",
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
    ...overrides,
  };
}

export function renderController(overrides: Partial<Parameters<typeof useTeamController>[0]> = {}) {
  const onAuthRequired = vi.fn();
  const initialProps = {
    activeTab: "team", hasRequiredAccountAuth: true, isEffectiveAuthRequired: true, isSupabaseConfigured: true,
    showAiClassificationImpact: true, startOfDayMinutes: 4 * 60, currentDay: "2026-07-02", timezone: "Asia/Seoul",
    user: signedInUser,
    onAuthRequired,
    ...overrides,
  };
  const hook = renderHook((props) => useTeamController(props), { initialProps });
  return { hook, initialProps, onAuthRequired };
}
