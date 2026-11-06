/**
 * Work blocks a member's app shares with a team that shares work titles or time of day
 * (docs/teams-server-sharing.md, later slice 2). A block is the one Your Day draws, named
 * as Your Day names it: a renamed block goes up renamed, a hidden name goes up without one,
 * and a block's description never leaves the device. Only the parts inside the team's hours
 * and after joining count, and only the items the team shares go up.
 */
import {
  activitySecondsWithinInterval,
  buildTeamProjectSliceProjection,
  clipDeviceElapsedTimeSegment,
  isBrowserHistoryImportSegment,
  isExcludedSegment,
  isFailedForegroundCaptureSegment,
  isPassiveSupportedSegment,
  isRemoteDeviceSegment,
  storedActivityTimelineCards,
  type ActivityBlockLabelLanguage,
  type ActivityBlockLabelRecord,
  type ActivitySegment,
  type ActivityTimelineWindowRecord,
  type ClassificationOptions,
  type ProjectWindowAssignmentRecord,
  type TeamProjectAssignmentRecord,
} from "@drifty/domain";

import { buildIsoDayList } from "../../lib/formatting";
import { buildActivityLabelBlocks, type ActivityLabelBlock } from "../activity-labels/activityLabelBlocks";
import { buildWeekDashboardDayModel } from "../dashboard/weekDashboardModel";
import { buildWeekTimelineEvents } from "../dashboard/weekTimelineEvents";
import type { TeamFocusDataset } from "./teamFocusModel";
import type { TeamWorkBlockEntry, TeamWorkBlockRow } from "./teamSharingService";
import type { TeamFocusBlock } from "./teamTypes";

/** What a team's policy lets a member send. */
export type TeamWorkShare = {
  /** Work titles, by day or by time. */
  readonly titles: boolean;
  /** Project time per person, by day or by time; a project goes with a name or a time. */
  readonly projects: boolean;
  /** Focus by time; a focus mark goes only with a time. */
  readonly focus: boolean;
  /** Some item is shared by time, so blocks keep their times. */
  readonly timed: boolean;
};

const BLOCK_MIN_SECONDS = 60;
/** A block takes a project, or a focus mark, when it holds at least half of the block's time. */
const MAJORITY = 0.5;

function local(segments: readonly ActivitySegment[]): ActivitySegment[] {
  return segments.filter((segment) => !isRemoteDeviceSegment(segment)
    && !isPassiveSupportedSegment(segment)
    && !isExcludedSegment(segment)
    && !isFailedForegroundCaptureSegment(segment)
    && !isBrowserHistoryImportSegment(segment));
}

/** The blocks Your Day draws for a range, with the names it shows. */
export function dayLabelBlocks(input: {
  readonly segments: readonly ActivitySegment[];
  readonly startDay: string;
  readonly endDay: string;
  readonly labels: readonly ActivityBlockLabelRecord[];
  readonly windows: readonly ActivityTimelineWindowRecord[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly language: ActivityBlockLabelLanguage;
  readonly nowMs: number;
}): ActivityLabelBlock[] {
  const segments = [...input.segments];
  const eventsByDay = new Map(buildIsoDayList(input.startDay, input.endDay).map((day) => [
    day,
    buildWeekDashboardDayModel({ day, segments, classificationOptions: input.classificationOptions, startOfDayMinutes: input.startOfDayMinutes }).calendarEvents,
  ]));
  const cards = storedActivityTimelineCards(input.windows, input.language);
  const timelineEvents = buildWeekTimelineEvents(eventsByDay, segments, cards, { startOfDayMinutes: input.startOfDayMinutes, classificationOptions: input.classificationOptions });
  return buildActivityLabelBlocks(timelineEvents, {
    startOfDayMinutes: input.startOfDayMinutes,
    segmentsById: new Map(segments.map((segment) => [segment.id, segment])),
    labels: input.labels,
    windows: input.windows,
    language: input.language,
    nowMs: input.nowMs,
  });
}

/**
 * Turns Your Day's blocks into what a team receives: each block cut to the team's hours, with the
 * part's recorded time, its team project and focus mark where one holds most of it, and its name.
 */
export function teamWorkBlockEntries(input: {
  readonly blocks: readonly ActivityLabelBlock[];
  /** This person's records after joining (not yet cut to the hours). */
  readonly segments: readonly ActivitySegment[];
  readonly spans: readonly { readonly start: number; readonly end: number }[];
  readonly assignments: readonly TeamProjectAssignmentRecord[];
  readonly windowAssignments: readonly ProjectWindowAssignmentRecord[];
  readonly share: TeamWorkShare;
  /** Focus seconds among records already cut to one part of a block; required for focus marks. */
  readonly focusSeconds?: (segments: readonly ActivitySegment[], day: string) => number;
}): TeamWorkBlockEntry[] {
  const { share } = input;
  if (!share.titles && !share.timed) return [];
  const records = local(input.segments);
  const byId = new Map(records.map((segment) => [segment.id, segment]));
  const projection = share.projects ? buildTeamProjectSliceProjection(records, input.windowAssignments, input.assignments) : null;
  const entries: TeamWorkBlockEntry[] = [];
  for (const block of input.blocks) {
    const ids = new Set(block.segmentIds);
    const title = share.titles && block.generation === "resolved" ? block.display?.title.trim() || null : null;
    if (!title && !share.timed) continue;
    for (const span of input.spans) {
      const start = Math.max(span.start, block.startMs);
      const end = Math.min(span.end, block.endMs);
      if (!(end > start)) continue;
      const parts: ActivitySegment[] = [];
      let seconds = 0;
      for (const id of ids) {
        const segment = byId.get(id);
        if (!segment) continue;
        const within = activitySecondsWithinInterval(segment, start, end);
        if (within <= 0) continue;
        seconds += within;
        parts.push(clipDeviceElapsedTimeSegment(segment, { start, end }));
      }
      if (seconds < BLOCK_MIN_SECONDS) continue;
      let projectId: string | null = null;
      if (projection) {
        const byProject = new Map<string, number>();
        for (const slice of projection.segments) {
          const source = projection.sourceSegmentIdBySliceId.get(slice.id) ?? slice.id;
          const project = projection.projectBySegmentId.get(slice.id);
          if (!project || !ids.has(source)) continue;
          byProject.set(project, (byProject.get(project) ?? 0) + activitySecondsWithinInterval(slice, start, end));
        }
        for (const [project, projectSeconds] of byProject) {
          if (projectSeconds >= seconds * MAJORITY && (projectId === null || projectSeconds > (byProject.get(projectId) ?? 0))) projectId = project;
        }
      }
      const focus = share.focus && share.timed && input.focusSeconds
        ? input.focusSeconds(parts, block.day) >= seconds * MAJORITY
        : null;
      entries.push({
        activity_date: block.day,
        started_at: share.timed ? new Date(start).toISOString() : null,
        ended_at: share.timed ? new Date(end).toISOString() : null,
        seconds: Math.round(seconds),
        project_id: projectId,
        title,
        focus,
      });
    }
  }
  return entries;
}

function minuteOfDay(iso: string, day: string): number {
  const midnight = new Date(day + "T00:00:00").getTime();
  return Math.max(0, Math.min(1440, Math.round((Date.parse(iso) - midnight) / 60_000)));
}

/**
 * Puts the blocks a seat read on each person's days, so the work calendar draws them. Days with
 * blocks but no shared focus still show their blocks; their focus stays as the server sent it.
 */
export function datasetWithWorkBlocks(dataset: TeamFocusDataset, rows: readonly TeamWorkBlockRow[]): TeamFocusDataset {
  const timed = rows.filter((row) => row.started_at && row.ended_at);
  if (timed.length === 0) return dataset;
  const byDay = new Map<string, TeamFocusBlock[]>();
  for (const row of timed) {
    const key = row.member_key + "\n" + row.activity_date;
    const list = byDay.get(key) ?? [];
    list.push({
      start_minute: minuteOfDay(row.started_at!, row.activity_date),
      end_minute: minuteOfDay(row.ended_at!, row.activity_date),
      project_id: row.organization_project_id,
      title: row.title,
      focus: row.is_focus,
    });
    byDay.set(key, list);
  }
  const used = new Set<string>();
  const focusDays = dataset.focusDays.map((day) => {
    const key = day.member_key + "\n" + day.activity_date;
    const blocks = byDay.get(key);
    if (!blocks) return day;
    used.add(key);
    return { ...day, blocks: blocks.sort((left, right) => left.start_minute - right.start_minute) };
  });
  for (const [key, blocks] of byDay) {
    if (used.has(key)) continue;
    const [memberKey, day] = key.split("\n") as [string, string];
    const seconds = timed.filter((row) => row.member_key === memberKey && row.activity_date === day).reduce((sum, row) => sum + row.seconds, 0);
    focusDays.push({
      member_key: memberKey,
      activity_date: day,
      focus_seconds: 0,
      tracked_seconds: seconds,
      deep_block_count: 0,
      deep_block_seconds: 0,
      longest_block_seconds: 0,
      longest_block_start_minute: null,
      blocks: blocks.sort((left, right) => left.start_minute - right.start_minute),
    });
  }
  const known = new Set(dataset.members.map((member) => member.member_key));
  const members = [...dataset.members];
  for (const row of timed) {
    if (known.has(row.member_key)) continue;
    known.add(row.member_key);
    members.push({ member_key: row.member_key, display_name: row.member_display_name, role_label: "", membership_role: "member", group_id: null, is_self: row.is_self, weekly_goal_seconds: null });
  }
  return { ...dataset, members, focusDays };
}

export type TeamWorkTitleDay = {
  readonly day: string;
  readonly items: readonly { readonly title: string; readonly seconds: number; readonly projectId: string | null }[];
};

/** One person's names by day in a window, biggest first, from names by day and names on times alike. */
export function teamWorkTitlesByDay(rows: readonly TeamWorkBlockRow[], memberKey: string, window?: { readonly start_date: string; readonly end_date: string }): TeamWorkTitleDay[] {
  const days = new Map<string, Map<string, { title: string; seconds: number; projects: Map<string | null, number> }>>();
  for (const row of rows) {
    if (row.member_key !== memberKey || !row.title) continue;
    if (window && (row.activity_date < window.start_date || row.activity_date > window.end_date)) continue;
    const titles = days.get(row.activity_date) ?? new Map();
    const entry = titles.get(row.title) ?? { title: row.title, seconds: 0, projects: new Map<string | null, number>() };
    entry.seconds += row.seconds;
    entry.projects.set(row.organization_project_id, (entry.projects.get(row.organization_project_id) ?? 0) + row.seconds);
    titles.set(row.title, entry);
    days.set(row.activity_date, titles);
  }
  return [...days.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, titles]) => ({
      day,
      items: [...titles.values()]
        .map((entry) => ({
          title: entry.title,
          seconds: entry.seconds,
          projectId: [...entry.projects.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
        }))
        .sort((left, right) => right.seconds - left.seconds || left.title.localeCompare(right.title)),
    }));
}

const PREVIEW_TITLES = ["Proposal draft", "Pricing page copy", "Client call notes", "Weekly review", "Onboarding flow fixes", "Release checklist"];

/**
 * The Dev preview's work titles: the preview's own blocks with sample names, by day or on their
 * times as the previewed team shares them. Never used for a live team.
 */
export function previewTeamWorkBlockRows(dataset: TeamFocusDataset, byTime: boolean): TeamWorkBlockRow[] {
  const names = new Map(dataset.members.map((member) => [member.member_key, member]));
  const rows: TeamWorkBlockRow[] = [];
  for (const day of dataset.focusDays) {
    const member = names.get(day.member_key);
    if (!member) continue;
    (day.blocks ?? []).forEach((block, index) => {
      let hash = 0;
      for (const char of day.member_key + day.activity_date + index) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      const midnight = new Date(day.activity_date + "T00:00:00").getTime();
      rows.push({
        member_key: day.member_key,
        member_display_name: member.display_name,
        is_self: member.is_self,
        activity_date: day.activity_date,
        started_at: byTime ? new Date(midnight + block.start_minute * 60_000).toISOString() : null,
        ended_at: byTime ? new Date(midnight + block.end_minute * 60_000).toISOString() : null,
        seconds: (block.end_minute - block.start_minute) * 60,
        organization_project_id: block.project_id,
        title: PREVIEW_TITLES[hash % PREVIEW_TITLES.length]!,
        is_focus: byTime ? true : null,
      });
    });
  }
  return rows;
}
