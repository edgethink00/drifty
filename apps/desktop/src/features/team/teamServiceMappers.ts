import type {
  DeletedTeam,
  LeftTeam,
  OwnTeam,
  PublishedTeamProjectTotals,
  RemovedTeamMember,
  StoppedTeamProjectSharing,
  TeamInvite,
  TeamMember,
  TeamMemberInvitesSetting,
  TeamMembershipRole,
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
} from "./teamTypes";
import { normalizeProjectColor } from "../../lib/colorPalette";
import {
  readBoolean,
  readInviteStatus,
  readNumber,
  readProjectStatus,
  readString,
  readTeamProjectAnchors,
  toRecord,
} from "./teamServiceRecords";

export function normalizeOwnTeam(row: unknown): OwnTeam {
  const record = toRecord(row);
  const roleLabel = readString(record, "role_label");
  return {
    organization_id: readString(record, "organization_id"),
    organization_name: readString(record, "organization_name"),
    member_display_name: readString(record, "member_display_name"),
    role_label: roleLabel,
    member_count: readNumber(record, "member_count"),
    updated_at: readString(record, "updated_at"),
    membership_role: readMembershipRole(record, roleLabel),
    members_can_invite: typeof record.members_can_invite === "boolean" ? record.members_can_invite : null,
  };
}

// A server without membership_role only let owners invite; the creation label
// is "Owner" there, so it is the closest stand-in until the schema rolls out.
function readMembershipRole(record: Record<string, unknown>, roleLabel: string): TeamMembershipRole {
  const value = record.membership_role;
  if (value === "owner" || value === "admin" || value === "member") return value;
  return roleLabel.trim().toLowerCase() === "owner" ? "owner" : "member";
}

export function normalizeTeamMemberInvitesSetting(row: unknown): TeamMemberInvitesSetting {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    members_can_invite: readBoolean(record, "members_can_invite"),
  };
}

export function normalizeTeamMember(row: unknown): TeamMember {
  const record = toRecord(row);
  const roleLabel = readString(record, "role_label");
  return {
    member_key: readString(record, "member_key"),
    display_name: readString(record, "display_name"),
    role_label: roleLabel,
    membership_role: readMembershipRole(record, roleLabel),
    joined_at: readString(record, "joined_at"),
    is_self: readBoolean(record, "is_self"),
  };
}

export function normalizeRemovedTeamMember(row: unknown): RemovedTeamMember {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    member_count: readNumber(record, "member_count"),
    removed_total_rows: readNumber(record, "removed_total_rows"),
    revoked_invite_count: readNumber(record, "revoked_invite_count"),
  };
}

export function normalizeLeftTeam(row: unknown): LeftTeam {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    removed_total_rows: readNumber(record, "removed_total_rows"),
    revoked_invite_count: readNumber(record, "revoked_invite_count"),
  };
}

export function normalizeDeletedTeam(row: unknown): DeletedTeam {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    member_count: readNumber(record, "member_count"),
    deleted_total_rows: readNumber(record, "deleted_total_rows"),
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

export function normalizeTeamProject(row: unknown): TeamProject {
  const record = toRecord(row);
  return {
    id: readString(record, "id"),
    organization_id: readString(record, "organization_id"),
    name: readString(record, "name"),
    description: readString(record, "description"),
    // Members may still publish legacy vivid values; resolve at the boundary so
    // project rows, mix slices and dashboards all share one palette.
    color: normalizeProjectColor(readString(record, "color")),
    status: readProjectStatus(record),
    anchors: readTeamProjectAnchors(record.anchors),
    can_manage: readBoolean(record, "can_manage"),
    created_at: readString(record, "created_at"),
    updated_at: readString(record, "updated_at"),
  };
}

export function normalizeTeamProjectMixRow(row: unknown): TeamProjectMixRow {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    organization_project_id: readString(record, "organization_project_id"),
    project_name: readString(record, "project_name"),
    project_color: normalizeProjectColor(readString(record, "project_color")),
    project_status: readProjectStatus({ status: record.project_status }),
    activity_date: readString(record, "activity_date"),
    seconds: readNumber(record, "seconds"),
  };
}

export function normalizeTeamProjectMemberRow(row: unknown): TeamProjectMemberRow {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    organization_project_id: readString(record, "organization_project_id"),
    project_name: readString(record, "project_name"),
    member_display_name: readString(record, "member_display_name"),
    seconds: readNumber(record, "seconds"),
  };
}

export function normalizePublishedTeamProjectTotals(row: unknown): PublishedTeamProjectTotals {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    window_start_date: readString(record, "window_start_date"),
    window_end_date: readString(record, "window_end_date"),
    published_row_count: readNumber(record, "published_row_count"),
    updated_at: readString(record, "updated_at"),
  };
}

export function normalizeStoppedTeamProjectSharing(row: unknown): StoppedTeamProjectSharing {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    deleted_row_count: readNumber(record, "deleted_row_count"),
    updated_at: readString(record, "updated_at"),
  };
}
