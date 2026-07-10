import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import type { AuthState } from "../auth/AuthContext";
import type { OwnTeam, TeamInvite, TeamResult } from "./teamService";
import { useTeamController } from "./useTeamController";

export const signedInUser: NonNullable<AuthState["user"]> = {
  id: "user-1", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-07-01T00:00:00.000Z", email: "alex@example.com",
};

export const privateTeam = makeTeam();

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
    member_count: 2, updated_at: "2026-07-02T08:00:00.000Z",
    ...overrides,
  };
}

export function renderController(overrides: Partial<Parameters<typeof useTeamController>[0]> = {}) {
  const onAuthRequired = vi.fn();
  const initialProps = {
    activeTab: "team", hasRequiredAccountAuth: true, isEffectiveAuthRequired: true, isSupabaseConfigured: true,
    user: signedInUser,
    onAuthRequired,
    ...overrides,
  };
  const hook = renderHook((props) => useTeamController(props), { initialProps });
  return { hook, initialProps, onAuthRequired };
}
