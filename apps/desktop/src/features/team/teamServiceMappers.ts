import type { OwnTeam, PublishedTeamFocusTotal, StoppedTeamFocusSharing, TeamFocusSummaryRow, TeamInvite, TeamLiveStatusRow } from "./teamTypes";
import {
  readInviteStatus,
  readNullableNumber,
  readNumber,
  readPeriod,
  readPresenceState,
  readShareScope,
  readString,
  toRecord,
} from "./teamServiceRecords";

export function normalizeOwnTeam(row: unknown): OwnTeam {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    organization_name: readString(record, "organization_name"),
    member_display_name: readString(record, "member_display_name"),
    role_label: readString(record, "role_label"),
    focus_share_scope: readShareScope(record),
    member_count: readNumber(record, "member_count"),
    focus_seconds: readNumber(record, "focus_seconds"),
    focus_score: readNumber(record, "focus_score"),
    private_rank: readNullableNumber(record, "private_rank"),
    window_start_date: readString(record, "window_start_date"),
    window_end_date: readString(record, "window_end_date"),
    updated_at: readString(record, "updated_at"),
  };
}

export function normalizeFocusSummaryRow(row: unknown): TeamFocusSummaryRow {
  return normalizeOwnTeam({ ...toRecord(row), member_count: 0 });
}

export function normalizeTeamLiveStatusRow(row: unknown): TeamLiveStatusRow {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    organization_name: readString(record, "organization_name"),
    member_display_name: readString(record, "member_display_name"),
    profile_avatar_url: readString(record, "profile_avatar_url"),
    role_label: readString(record, "role_label"),
    focus_share_scope: readShareScope(record),
    presence_state: readPresenceState(record),
    focus_seconds: readNumber(record, "focus_seconds"),
    focus_score: readNumber(record, "focus_score"),
    window_start_date: readString(record, "window_start_date"),
    window_end_date: readString(record, "window_end_date"),
    last_shared_at: readString(record, "last_shared_at"),
  };
}

export function normalizeTeamInvite(row: unknown): TeamInvite {
  const record = toRecord(row);
  return {
    invite_id: readString(record, "invite_id"),
    organization_id: readString(record, "organization_id"),
    organization_name: readString(record, "organization_name"),
    invite_code: readString(record, "invite_code"),
    invite_url: readString(record, "invite_url"),
    role_label: readString(record, "role_label"),
    status: readInviteStatus(record),
    expires_at: readString(record, "expires_at"),
    created_at: readString(record, "created_at"),
    updated_at: readString(record, "updated_at"),
  };
}

export function normalizePublishedFocusTotal(row: unknown): PublishedTeamFocusTotal {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    period: readPeriod(record),
    focus_share_scope: readShareScope(record),
    focus_seconds: readNumber(record, "focus_seconds"),
    focus_score: readNumber(record, "focus_score"),
    window_start_date: readString(record, "window_start_date"),
    window_end_date: readString(record, "window_end_date"),
    updated_at: readString(record, "updated_at"),
  };
}

export function normalizeStoppedSharing(row: unknown): StoppedTeamFocusSharing {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    focus_share_scope: readShareScope(record),
    deleted_focus_total_count: readNumber(record, "deleted_focus_total_count"),
    updated_at: readString(record, "updated_at"),
  };
}
