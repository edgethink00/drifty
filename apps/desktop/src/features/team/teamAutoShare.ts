/**
 * Automatic team sharing (product decision 2026-10-18, "Records inside the team's
 * hours are shared automatically"): for a team with stored sharing, this person's
 * own project time and focus go up as day totals without a button. Only records
 * inside the team's hours and after they joined count, and only the items the
 * team shares; the server also drops days before the team began sharing them.
 * Nothing but per-project and per-day seconds leaves the device.
 */
import { logicalDayIsoDateForDate, shiftIsoDate } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import { readCategoryProductivityPreferences, readDeletedCategoryCutoffs } from "../settings/categoryCustomizationStore";
import { teamActivitySince, teamActivityWithinSpans } from "./teamActivitySince";
import { teamFocusDayTotals, type TeamFocusClassification } from "./teamFocusPublish";
import { teamRecordingSpansBetween } from "./teamManagedHours";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";
import { publishTeamProjectTotals } from "./teamService";
import { fetchTeamMembershipStart, publishTeamFocusDays } from "./teamSharingService";
import type { TeamSharingPolicy } from "./teamSharingPolicy";
import type { TeamRecordingSchedule } from "./teamSharingScope";

/** How far back each automatic share reaches, so a few days offline still arrive whole. */
export const TEAM_AUTO_SHARE_DAYS = 14;

export type TeamAutoShareTarget = {
  readonly organizationId: string;
  readonly displayName: string;
  /** The team's stored sharing; teams without one keep the Share button. */
  readonly policy: TeamSharingPolicy;
  /** The team's hours; without them nothing is shared. */
  readonly schedule: TeamRecordingSchedule | null;
};

export type TeamAutoShareOptions = {
  readonly startOfDayMinutes: number;
  /** How the person's own charts classify focus; focus is sent only with it. */
  readonly focusClassification: TeamFocusClassification | null;
  readonly nowMs?: number;
};

export type TeamAutoShareResult =
  | { readonly status: "shared"; readonly projectDays: number; readonly focusDays: number }
  | { readonly status: "nothing" }
  | { readonly status: "failed"; readonly error: string };

/** The logical days one share covers: the last two weeks, never before the day this person joined. */
export function teamAutoShareWindow(today: string, joinedDay: string, days = TEAM_AUTO_SHARE_DAYS): { readonly start_date: string; readonly end_date: string } | null {
  const earliest = shiftIsoDate(today, -(Math.max(1, days) - 1));
  const start = joinedDay > earliest ? joinedDay : earliest;
  return start <= today ? { start_date: start, end_date: today } : null;
}

export async function shareOwnTeamTime(target: TeamAutoShareTarget, options: TeamAutoShareOptions): Promise<TeamAutoShareResult> {
  const sharesProjects = target.policy.projects !== "off";
  const focusClassification = target.policy.focus !== "off" ? options.focusClassification : null;
  if ((!sharesProjects && !focusClassification) || !target.schedule) return { status: "nothing" };

  const membership = await fetchTeamMembershipStart(target.organizationId);
  if (!membership.success) return { status: "failed", error: membership.error };
  const nowMs = options.nowMs ?? Date.now();
  const joinedMs = Date.parse(membership.data);
  if (!Number.isFinite(joinedMs) || joinedMs >= nowMs) return { status: "nothing" };
  const today = logicalDayIsoDateForDate(new Date(nowMs), options.startOfDayMinutes);
  const joinedDay = logicalDayIsoDateForDate(new Date(joinedMs), options.startOfDayMinutes);
  const window = teamAutoShareWindow(today, joinedDay);
  if (!window) return { status: "nothing" };

  const range = getLogicalDayRange(window.start_date, window.end_date, options.startOfDayMinutes);
  const spans = teamRecordingSpansBetween(target.schedule, Math.max(joinedMs, new Date(range.start).getTime()), nowMs);
  if (spans.length === 0) return { status: "nothing" };
  const [timeline, assignments, windowAssignments] = await Promise.all([
    trackerClient.getTimeline(range),
    trackerClient.getTeamProjectAssignments(range),
    trackerClient.getProjectWindowAssignments(range),
  ]);
  const activity = teamActivityWithinSpans(teamActivitySince(timeline, membership.data), spans);
  const projectEntries = sharesProjects
    ? aggregateTeamProjectDayTotals(assignments, activity, options.startOfDayMinutes, windowAssignments)
    : [];
  const focusEntries = focusClassification
    ? teamFocusDayTotals(activity, window, focusClassification, options.startOfDayMinutes, {
      categoryProductivity: readCategoryProductivityPreferences(),
      deletedCategories: readDeletedCategoryCutoffs(),
    })
    : null;
  // Each publish replaces the window's days, so an empty read never goes up and wipes what was shared.
  if (projectEntries.length === 0 && !focusEntries?.length) return { status: "nothing" };

  if (focusEntries) {
    const focus = await publishTeamFocusDays({
      organization_id: target.organizationId,
      display_name: target.displayName,
      window_start_date: window.start_date,
      window_end_date: window.end_date,
      entries: focusEntries,
    });
    if (!focus.success) return { status: "failed", error: focus.error };
  }
  if (projectEntries.length > 0) {
    const projects = await publishTeamProjectTotals({
      organization_id: target.organizationId,
      display_name: target.displayName,
      window_start_date: window.start_date,
      window_end_date: window.end_date,
      entries: projectEntries,
    });
    if (!projects.success) return { status: "failed", error: projects.error };
  }
  return { status: "shared", projectDays: projectEntries.length, focusDays: focusEntries?.length ?? 0 };
}
