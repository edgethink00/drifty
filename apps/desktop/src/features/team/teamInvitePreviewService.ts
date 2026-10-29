import { fail, invokeTeamInvite, ok } from "./teamServiceClient";
import { TEAM_FOCUS_SHARE_LEVELS, TEAM_PROJECT_SHARE_LEVELS, TEAM_TASK_SHARE_LEVELS } from "./teamSharingPolicy";
import type { TeamClient, TeamInvitePreview, TeamResult } from "./teamTypes";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isLevel<T extends string>(value: unknown, levels: readonly T[]): value is T {
  return typeof value === "string" && levels.some((level) => level === value);
}

function validTimezone(value: unknown): value is string {
  if (value === "local") return true;
  if (typeof value !== "string" || !value) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

/** Fail closed on an old or malformed server response; never infer from a selected team. */
export async function previewTeamInvite(inviteKey: string, client?: TeamClient | null): Promise<TeamResult<TeamInvitePreview>> {
  if (!inviteKey.trim() || inviteKey.length > 500) return fail("invalid_input", "Enter a valid team invite code or link.");
  const response = await invokeTeamInvite({ action: "preview", inviteKey: inviteKey.trim() }, client);
  if (!response.success) return response;
  const value = record(response.data.preview);
  const policy = record(value?.policy);
  const schedule = record(value?.schedule);
  if (!value || !policy || typeof value.organizationId !== "string" || !value.organizationId
    || typeof value.organizationName !== "string" || !value.organizationName.trim()
    || typeof value.roleLabel !== "string" || !value.roleLabel.trim()
    || typeof value.policyVersion !== "string" || !/^[a-f0-9]{32}$/.test(value.policyVersion)
    || !isLevel(policy.projects, TEAM_PROJECT_SHARE_LEVELS)
    || !isLevel(policy.tasks, TEAM_TASK_SHARE_LEVELS)
    || !isLevel(policy.focus, TEAM_FOCUS_SHARE_LEVELS) || typeof policy.memberSummary !== "boolean"
    || (value.trackingPolicy !== "managed" && value.trackingPolicy !== "free")) return fail("remote_error", "Unable to read team sharing settings.");
  if (value.schedule !== null && (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0
    || !schedule.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    || !Number.isInteger(schedule.start_minute) || !Number.isInteger(schedule.end_minute)
    || Number(schedule.start_minute) < 0 || Number(schedule.end_minute) > 1440
    || Number(schedule.start_minute) >= Number(schedule.end_minute)
    || !validTimezone(schedule.timezone))) return fail("remote_error", "Unable to read team sharing settings.");
  if (value.trackingPolicy === "managed" && !schedule) return fail("remote_error", "Unable to read team sharing settings.");
  const recipient = typeof value.invitedEmail === "string" && value.invitedEmail && typeof value.invitedEmailMatches === "boolean"
    ? { invitedEmail: value.invitedEmail, invitedEmailMatches: value.invitedEmailMatches }
    : {};
  return ok({
    organizationId: value.organizationId, organizationName: value.organizationName, roleLabel: value.roleLabel,
    policyVersion: value.policyVersion, trackingPolicy: value.trackingPolicy,
    policy: { projects: policy.projects, tasks: policy.tasks, focus: policy.focus, memberSummary: policy.memberSummary },
    schedule: schedule ? { days: schedule.days, start_minute: schedule.start_minute, end_minute: schedule.end_minute, timezone: schedule.timezone } as TeamInvitePreview["schedule"] : null,
    ...recipient,
  });
}
