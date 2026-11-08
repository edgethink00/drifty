/**
 * Automatic team sharing (product decision 2026-10-18, "Records inside the team's
 * hours are shared automatically"): for a team with stored sharing, this person's
 * own project time and focus go up as day totals without a button. Only records
 * inside the team's hours and after they joined count, and only the items the
 * team shares; the server also drops days before the team began sharing them.
 * Nothing but per-project and per-day seconds leaves the device.
 */
import {
  activityTimeBounds,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  isPassiveSupportedSegment,
  isRemoteDeviceSegment,
  logicalDayIsoDateForDate,
  shiftIsoDate,
  type ActivityBlockLabelLanguage,
  type ActivitySegment,
} from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import { readCategoryProductivityPreferences, readDeletedCategoryCutoffs } from "../settings/categoryCustomizationStore";
import { teamActivitySince, teamActivityWithinSpans } from "./teamActivitySince";
import { teamFocusDayTotals, type TeamFocusClassification } from "./teamFocusPublish";
import { teamRecordingSpansBetween } from "./teamManagedHours";
import { aggregateTeamProjectDayTotals } from "./teamProjectTime";
import { publishTeamProjectTotals } from "./teamService";
import { fetchTeamMembershipStart, publishTeamFocusDays, publishTeamWorkBlocks } from "./teamSharingService";
import type { TeamSharingPolicy } from "./teamSharingPolicy";
import type { TeamRecordingSchedule } from "./teamSharingScope";
import { dayLabelBlocks, teamWorkBlockEntries, type TeamWorkShare } from "./teamWorkBlocks";

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
  /** The language Your Day names blocks in, so a team reads the names the person sees. */
  readonly language?: ActivityBlockLabelLanguage;
  readonly nowMs?: number;
};

/** Why a pass sent nothing, so the member's sharing status can say it plainly. */
export type TeamAutoShareIdleReason = "nothing-shared" | "no-hours" | "not-joined" | "outside-hours" | "no-records";

/** How far back the member's sharing status adds up their shared time. */
export const TEAM_SHARE_RECENT_DAYS = 7;

export type TeamAutoShareResult =
  | {
    readonly status: "shared";
    readonly projectDays: number;
    readonly focusDays: number;
    readonly workBlocks: number;
    /** Tracked time inside the team's hours over the last week, as this pass sent it. */
    readonly recentSeconds?: number;
  }
  | { readonly status: "nothing"; readonly reason?: TeamAutoShareIdleReason }
  | { readonly status: "failed"; readonly error: string };

/** The tracked seconds of the shared records on the last few logical days (the focus card's boundary). */
export function teamSharedRecentSeconds(activity: readonly ActivitySegment[], today: string, startOfDayMinutes: number, days = TEAM_SHARE_RECENT_DAYS): number {
  const first = shiftIsoDate(today, -(Math.max(1, days) - 1));
  let total = 0;
  for (const segment of activity) {
    if (isBrowserHistoryImportSegment(segment) || isExcludedSegment(segment) || isFailedForegroundCaptureSegment(segment)
      || isPassiveSupportedSegment(segment) || isRemoteDeviceSegment(segment)) continue;
    const bounds = activityTimeBounds(segment);
    if (!Number.isFinite(bounds.start) || !(bounds.end > bounds.start)) continue;
    const day = logicalDayIsoDateForDate(new Date(bounds.start), startOfDayMinutes);
    if (day < first || day > today) continue;
    total += Math.max(0, segment.durationSeconds);
  }
  return Math.round(total);
}

/** What of a person's blocks a team's policy takes, or null when it takes none. */
export function teamWorkShare(policy: TeamSharingPolicy): TeamWorkShare | null {
  const timed = policy.projects === "hourly" || policy.tasks === "hourly" || policy.focus === "hourly";
  const titles = policy.tasks !== "off";
  if (!timed && !titles) return null;
  return { titles, timed, projects: policy.projects === "member_daily" || policy.projects === "hourly", focus: policy.focus === "hourly" };
}

/** The logical days one share covers: the last two weeks, never before the day this person joined. */
export function teamAutoShareWindow(today: string, joinedDay: string, days = TEAM_AUTO_SHARE_DAYS): { readonly start_date: string; readonly end_date: string } | null {
  const earliest = shiftIsoDate(today, -(Math.max(1, days) - 1));
  const start = joinedDay > earliest ? joinedDay : earliest;
  return start <= today ? { start_date: start, end_date: today } : null;
}

export async function shareOwnTeamTime(target: TeamAutoShareTarget, options: TeamAutoShareOptions): Promise<TeamAutoShareResult> {
  const sharesProjects = target.policy.projects !== "off";
  const focusClassification = target.policy.focus !== "off" ? options.focusClassification : null;
  const workShare = teamWorkShare(target.policy);
  if (!sharesProjects && !focusClassification && !workShare) return { status: "nothing", reason: "nothing-shared" };
  if (!target.schedule) return { status: "nothing", reason: "no-hours" };

  const membership = await fetchTeamMembershipStart(target.organizationId);
  if (!membership.success) return { status: "failed", error: membership.error };
  const nowMs = options.nowMs ?? Date.now();
  const joinedMs = Date.parse(membership.data);
  if (!Number.isFinite(joinedMs) || joinedMs >= nowMs) return { status: "nothing", reason: "not-joined" };
  const today = logicalDayIsoDateForDate(new Date(nowMs), options.startOfDayMinutes);
  const joinedDay = logicalDayIsoDateForDate(new Date(joinedMs), options.startOfDayMinutes);
  const window = teamAutoShareWindow(today, joinedDay);
  if (!window) return { status: "nothing", reason: "not-joined" };

  const range = getLogicalDayRange(window.start_date, window.end_date, options.startOfDayMinutes);
  const spans = teamRecordingSpansBetween(target.schedule, Math.max(joinedMs, new Date(range.start).getTime()), nowMs);
  if (spans.length === 0) return { status: "nothing", reason: "outside-hours" };
  const [timeline, assignments, windowAssignments] = await Promise.all([
    trackerClient.getTimeline(range),
    trackerClient.getTeamProjectAssignments(range),
    trackerClient.getProjectWindowAssignments(range),
  ]);
  const activity = teamActivityWithinSpans(teamActivitySince(timeline, membership.data), spans);
  const preferences = { categoryProductivity: readCategoryProductivityPreferences(), deletedCategories: readDeletedCategoryCutoffs() };
  const projectEntries = sharesProjects
    ? aggregateTeamProjectDayTotals(assignments, activity, options.startOfDayMinutes, windowAssignments)
    : [];
  const focusEntries = focusClassification
    ? teamFocusDayTotals(activity, window, focusClassification, options.startOfDayMinutes, preferences)
    : null;
  const workEntries = workShare
    ? await readWorkBlockEntries({ timeline, since: teamActivitySince(timeline, membership.data), spans, assignments, windowAssignments, range, window, workShare, options, preferences, nowMs })
    : [];
  // Each publish replaces the window's days, so an empty read never goes up and wipes what was shared.
  if (projectEntries.length === 0 && !focusEntries?.length && workEntries.length === 0) return { status: "nothing", reason: "no-records" };

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
  if (workEntries.length > 0) {
    // Sent last: a server without work blocks yet refuses only these, after the day totals went up.
    const work = await publishTeamWorkBlocks({
      organization_id: target.organizationId,
      display_name: target.displayName,
      window_start_date: window.start_date,
      window_end_date: window.end_date,
      entries: workEntries,
    });
    if (!work.success) return { status: "failed", error: work.error };
  }
  return {
    status: "shared",
    projectDays: projectEntries.length,
    focusDays: focusEntries?.length ?? 0,
    workBlocks: workEntries.length,
    recentSeconds: teamSharedRecentSeconds(activity, today, options.startOfDayMinutes),
  };
}

async function readWorkBlockEntries(input: {
  readonly timeline: readonly ActivitySegment[];
  readonly since: readonly ActivitySegment[];
  readonly spans: ReturnType<typeof teamRecordingSpansBetween>;
  readonly assignments: Awaited<ReturnType<typeof trackerClient.getTeamProjectAssignments>>;
  readonly windowAssignments: Awaited<ReturnType<typeof trackerClient.getProjectWindowAssignments>>;
  readonly range: { readonly start: string; readonly end: string };
  readonly window: { readonly start_date: string; readonly end_date: string };
  readonly workShare: TeamWorkShare;
  readonly options: TeamAutoShareOptions;
  readonly preferences: { readonly categoryProductivity: ReturnType<typeof readCategoryProductivityPreferences>; readonly deletedCategories: ReturnType<typeof readDeletedCategoryCutoffs> };
  readonly nowMs: number;
}) {
  const [labels, windows] = await Promise.all([
    trackerClient.getActivityBlockLabels?.(input.range) ?? [],
    trackerClient.getActivityTimelineCards?.(input.range) ?? [],
  ]);
  // Blocks follow Your Day, which classifies with the person's own settings whether or not focus is shared.
  const classification = input.options.focusClassification ?? { includeAiClassifications: true };
  const blocks = dayLabelBlocks({
    segments: input.timeline,
    startDay: input.window.start_date,
    endDay: input.window.end_date,
    labels,
    windows,
    classificationOptions: {
      fallbackCandidates: [...input.timeline],
      includeAiClassifications: classification.includeAiClassifications,
      includeBuiltInHeuristics: classification.includeBuiltInHeuristics,
      builtInHeuristicsUnavailableSince: classification.builtInHeuristicsUnavailableSince,
      ...input.preferences,
    },
    startOfDayMinutes: input.options.startOfDayMinutes,
    language: input.options.language ?? "en",
    nowMs: input.nowMs,
  });
  const focusClassification = input.workShare.focus ? input.options.focusClassification : null;
  return teamWorkBlockEntries({
    blocks,
    segments: input.since,
    spans: input.spans,
    assignments: input.assignments,
    windowAssignments: input.windowAssignments,
    share: input.workShare,
    focusSeconds: focusClassification
      ? (segments, day) => teamFocusDayTotals(segments, { start_date: day, end_date: day }, focusClassification, input.options.startOfDayMinutes, input.preferences)[0]?.seconds ?? 0
      : undefined,
  });
}
