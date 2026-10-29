import type {
  DeletedTeam,
  LeftTeam,
  OwnEmailInvite,
  OwnTeam,
  PublishedTeamProjectTotals,
  RemovedTeamMember,
  StoppedTeamProjectSharing,
  TeamEmailInvite,
  TeamEmailInviteOutcome,
  TeamEmailInviteResult,
  TeamInvite,
  TeamMember,
  TeamMemberInvitesSetting,
  TeamMembershipRole,
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
  TeamSharingSettings,
} from "./teamTypes";
import { parseTeamSharingScope, parseTeamTrackingPolicy } from "./teamSharingScope";
import { normalizeProjectColor } from "../../lib/colorPalette";
import {
  isRecord,
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
    // A server without sharing scopes leaves these null, and the dashboards keep the project-totals view.
    sharing_scope: parseTeamSharingScope(record.sharing_scope),
    tracking_policy: parseTeamTrackingPolicy(record.tracking_policy),
    recording_schedule: null,
    group_count: typeof record.group_count === "number" && Number.isFinite(record.group_count) ? record.group_count : 0,
    viewer_group_id: typeof record.viewer_group_id === "string" ? record.viewer_group_id : null,
  };
}

// A server without membership_role only let owners invite; the creation label
// is "Owner" there, so it is the closest stand-in until the schema rolls out.
// The server's manager is the client's lead: they see the teams they manage.
function readMembershipRole(record: Record<string, unknown>, roleLabel: string): TeamMembershipRole {
  const value = record.membership_role;
  if (value === "owner" || value === "admin" || value === "lead" || value === "member") return value;
  if (value === "manager") return "lead";
  return roleLabel.trim().toLowerCase() === "owner" ? "owner" : "member";
}

export function normalizeTeamSharingSettings(row: unknown): TeamSharingSettings {
  const record = toRecord(row);
  return {
    organization_id: readString(record, "organization_id"),
    sharing_scope: parseTeamSharingScope(record.sharing_scope),
    tracking_policy: parseTeamTrackingPolicy(record.tracking_policy),
  };
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

export function normalizeTeamEmailInvite(row: unknown): TeamEmailInvite {
  const record = toRecord(row);
  const lastSentAt = readString(record, "last_sent_at");
  return {
    invite_id: readString(record, "invite_id"),
    invited_email: readString(record, "invited_email"),
    status: readInviteStatus(record),
    expires_at: readString(record, "expires_at"),
    last_sent_at: lastSentAt || null,
    send_count: readNumber(record, "send_count"),
    created_at: readString(record, "created_at"),
    sent_by_me: readBoolean(record, "sent_by_me"),
  };
}

export function normalizeOwnEmailInvite(row: unknown): OwnEmailInvite {
  const record = toRecord(row);
  return {
    invite_id: readString(record, "invite_id"),
    organization_id: readString(record, "organization_id"),
    organization_name: readString(record, "organization_name"),
    invite_code: readString(record, "invite_code"),
    invited_email: readString(record, "invited_email"),
    expires_at: readString(record, "expires_at"),
  };
}

const EMAIL_INVITE_OUTCOMES: readonly TeamEmailInviteOutcome[] = ["sent", "again", "member", "recent", "limited", "failed"];

/** A send's per-address outcomes; an entry the app does not know counts as failed. */
export function readEmailInviteResults(value: unknown): readonly TeamEmailInviteResult[] {
  if (!Array.isArray(value)) return [];
  const results: TeamEmailInviteResult[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.email !== "string" || !entry.email) continue;
    const outcome = EMAIL_INVITE_OUTCOMES.find((candidate) => candidate === entry.outcome) ?? "failed";
    results.push({ email: entry.email, outcome });
  }
  return results;
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
  const slot = record.member_slot;
  return {
    organization_id: readString(record, "organization_id"),
    organization_project_id: readString(record, "organization_project_id"),
    project_name: readString(record, "project_name"),
    member_display_name: readString(record, "member_display_name"),
    member_key: typeof record.member_key === "string" && record.member_key ? record.member_key : null,
    member_slot: typeof slot === "number" && Number.isInteger(slot) ? slot : null,
    is_self: typeof record.is_self === "boolean" ? record.is_self : null,
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
