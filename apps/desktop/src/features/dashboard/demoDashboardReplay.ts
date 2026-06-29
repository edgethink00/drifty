import {
  logicalDayEndExclusiveMs,
  logicalDayIsoDateForDate,
  logicalDayStartMs,
  shiftIsoDate,
  type ActivityCategory,
  type ActivitySegment,
  type ProductivityLabel,
  type StoredClassificationSource,
} from "@drifty/domain";
import { formatLocalDateTime } from "../../lib/formatting";
import type { StartOfWeek } from "../settings/settingsStorage";
import { getCalendarWeekStartDay } from "./weekCalendar";

export type DemoDashboardReplayKind = "day" | "week";
export type DemoDashboardReplayPhase = "idle" | "pre_roll" | "playing" | "complete";

export type DemoDashboardReplayAnchorInput = { readonly kind: DemoDashboardReplayKind; readonly currentLogicalDay: string; readonly startOfDayMinutes: number; readonly startOfWeek: StartOfWeek };
export type DemoDashboardReplayCurrentDayInput = { readonly currentDate: Date; readonly startOfDayMinutes: number };
export type DemoDashboardReplayAnchor = { readonly kind: DemoDashboardReplayKind; readonly anchorDay: string; readonly startDay: string; readonly endDay: string; readonly rangeStart: string; readonly rangeEnd: string; readonly startOfDayMinutes: number };
export type DemoDashboardReplayFixture = { readonly kind: DemoDashboardReplayKind; readonly anchor: DemoDashboardReplayAnchor; readonly segments: ActivitySegment[]; readonly totalSeconds: number };
export type DemoDashboardReplayProgressInput = { readonly elapsedMs: number; readonly durationSeconds: number };
export type DemoDashboardReplaySliceInput = { readonly anchor: DemoDashboardReplayAnchor; readonly progress: number; readonly segments: readonly ActivitySegment[] };
export type DemoDashboardReplaySlice = { readonly kind: DemoDashboardReplayKind; readonly progress: number; readonly segments: ActivitySegment[]; readonly virtualCurrentDay: string; readonly virtualCurrentMinuteOfDay: number; readonly virtualNow: string };

type SegmentBlueprint = readonly [
  idSuffix: string,
  dayOffset: number,
  startMinute: number,
  durationMinutes: number,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
  reason: string,
  site?: readonly [domain: string, title: string],
];

type AnchorParts = { readonly kind: DemoDashboardReplayKind; readonly anchorDay: string; readonly startDay: string; readonly endDay: string; readonly startOfDayMinutes: number };

const CLASSIFICATION_SOURCE: StoredClassificationSource = "manual";
const SYNTHETIC_CONFIDENCE = 0.96;
const ONE_MINUTE_MS = 60_000;

const DAY_BLUEPRINTS = [
  ["morning-deep-work", 0, 9 * 60, 105, "Focus Studio", "workspace", "focus", "Synthetic morning deep work."],
  ["communication-check-in", 0, 10 * 60 + 50, 30, "Team Check-in", "communication", "neutral", "Synthetic communication check-in."],
  ["learning-research", 0, 11 * 60 + 30, 50, "Research Browser", "learning", "focus", "Synthetic learning and research.", ["docs.example.test", "Synthetic research notes"]],
  ["short-social-drift", 0, 13 * 60 + 15, 15, "Social Browser", "social_media", "drift", "Synthetic short social interruption.", ["social.example.test", "Synthetic social feed"]],
  ["recovery-focus", 0, 13 * 60 + 35, 90, "Focus Studio", "workspace", "focus", "Synthetic recovery focus block."],
  ["utility-admin", 0, 15 * 60 + 15, 30, "Admin Console", "utility", "neutral", "Synthetic utility and admin work."],
  ["wrap-up", 0, 16 * 60 + 10, 40, "Planning Notes", "workspace", "focus", "Synthetic wrap-up planning."],
] satisfies readonly SegmentBlueprint[];

const WEEK_BLUEPRINTS = [
  ["mon-planning", 0, 8 * 60 + 45, 120, "Focus Studio", "workspace", "focus", "Synthetic Monday planning."],
  ["mon-check-in", 0, 11 * 60, 30, "Team Check-in", "communication", "neutral", "Synthetic Monday check-in."],
  ["mon-social", 0, 13 * 60 + 20, 20, "Social Browser", "social_media", "drift", "Synthetic Monday drift.", ["social.example.test", "Synthetic browser context"]],
  ["mon-research", 0, 14 * 60, 75, "Research Browser", "learning", "focus", "Synthetic Monday research.", ["docs.example.test", "Synthetic browser context"]],
  ["tue-build", 1, 9 * 60, 90, "Focus Studio", "workspace", "focus", "Synthetic Tuesday build work."],
  ["tue-admin", 1, 11 * 60, 45, "Admin Console", "utility", "neutral", "Synthetic Tuesday admin."],
  ["tue-video-drift", 1, 13 * 60, 30, "Media Browser", "entertainment", "drift", "Synthetic Tuesday video drift.", ["video.example.test", "Synthetic browser context"]],
  ["tue-deep-work", 1, 14 * 60, 105, "Focus Studio", "workspace", "focus", "Synthetic Tuesday deep work."],
  ["wed-sync", 2, 9 * 60, 60, "Team Check-in", "communication", "neutral", "Synthetic Wednesday sync."],
  ["wed-learning", 2, 10 * 60 + 15, 120, "Research Browser", "learning", "focus", "Synthetic Wednesday learning.", ["learn.example.test", "Synthetic browser context"]],
  ["wed-social", 2, 13 * 60 + 30, 15, "Social Browser", "social_media", "drift", "Synthetic Wednesday social interruption.", ["social.example.test", "Synthetic browser context"]],
  ["wed-recovery", 2, 14 * 60, 90, "Focus Studio", "workspace", "focus", "Synthetic Wednesday recovery work."],
  ["thu-deep-work", 3, 8 * 60 + 30, 150, "Focus Studio", "workspace", "focus", "Synthetic Thursday deep work."],
  ["thu-check-in", 3, 11 * 60 + 30, 30, "Team Check-in", "communication", "neutral", "Synthetic Thursday check-in."],
  ["thu-shopping-drift", 3, 13 * 60 + 10, 25, "Utility Browser", "shopping", "drift", "Synthetic Thursday shopping drift.", ["shop.example.test", "Synthetic browser context"]],
  ["thu-admin", 3, 14 * 60, 60, "Admin Console", "utility", "neutral", "Synthetic Thursday admin."],
  ["fri-focus", 4, 9 * 60, 105, "Focus Studio", "workspace", "focus", "Synthetic Friday focus."],
  ["fri-learning", 4, 11 * 60, 45, "Research Browser", "learning", "focus", "Synthetic Friday learning.", ["docs.example.test", "Synthetic browser context"]],
  ["fri-wrap-sync", 4, 13 * 60, 30, "Team Check-in", "communication", "neutral", "Synthetic Friday wrap-up sync."],
  ["fri-media-drift", 4, 15 * 60, 35, "Media Browser", "entertainment", "drift", "Synthetic Friday media drift.", ["video.example.test", "Synthetic browser context"]],
  ["sat-learning", 5, 10 * 60, 80, "Research Browser", "learning", "focus", "Synthetic Saturday learning.", ["learn.example.test", "Synthetic browser context"]],
  ["sat-social", 5, 12 * 60, 25, "Social Browser", "social_media", "drift", "Synthetic Saturday social drift.", ["social.example.test", "Synthetic browser context"]],
  ["sat-utility", 5, 14 * 60, 50, "Admin Console", "utility", "neutral", "Synthetic Saturday utility work."],
  ["sun-planning", 6, 10 * 60, 65, "Planning Notes", "workspace", "focus", "Synthetic Sunday planning."],
  ["sun-check-in", 6, 12 * 60, 35, "Team Check-in", "communication", "neutral", "Synthetic Sunday check-in."],
  ["sun-media", 6, 15 * 60, 20, "Media Browser", "entertainment", "drift", "Synthetic Sunday media drift.", ["video.example.test", "Synthetic browser context"]],
] satisfies readonly SegmentBlueprint[];

export function resolveDemoDashboardReplayCurrentLogicalDay(input: DemoDashboardReplayCurrentDayInput): string {
  return logicalDayIsoDateForDate(input.currentDate, input.startOfDayMinutes);
}

export function buildDemoDashboardReplayAnchor(input: DemoDashboardReplayAnchorInput): DemoDashboardReplayAnchor {
  switch (input.kind) {
    case "day":
      return anchorFor({
        kind: input.kind,
        anchorDay: input.currentLogicalDay,
        startDay: input.currentLogicalDay,
        endDay: input.currentLogicalDay,
        startOfDayMinutes: input.startOfDayMinutes,
      });
    case "week": {
      const currentWeekStart = getCalendarWeekStartDay(input.currentLogicalDay, input.startOfWeek);
      const startDay = shiftIsoDate(currentWeekStart, -7);
      const endDay = shiftIsoDate(currentWeekStart, -1);
      return anchorFor({ kind: input.kind, anchorDay: endDay, startDay, endDay, startOfDayMinutes: input.startOfDayMinutes });
    }
    default:
      return assertNever(input.kind);
  }
}

export function buildDemoDashboardReplayFixture(anchor: DemoDashboardReplayAnchor): DemoDashboardReplayFixture {
  const blueprints = blueprintsForKind(anchor.kind);
  const segments = blueprints.map((blueprint, index) => segmentFromBlueprint(anchor, blueprint, index));
  return {
    kind: anchor.kind,
    anchor,
    segments,
    totalSeconds: segments.reduce((total, segment) => total + segment.durationSeconds, 0),
  };
}

export function resolveDemoDashboardReplayProgress(input: DemoDashboardReplayProgressInput): number {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    return Number.isFinite(input.elapsedMs) && input.elapsedMs > 0 ? 1 : 0;
  }
  if (!Number.isFinite(input.elapsedMs)) return 0;
  return clampProgress(input.elapsedMs / (input.durationSeconds * 1000));
}

export function sliceDemoDashboardReplaySegments(input: DemoDashboardReplaySliceInput): DemoDashboardReplaySlice {
  const progress = clampProgress(input.progress);
  const range = replayRange(input.anchor);
  if (!range) {
    return emptySlice(input.anchor, progress);
  }

  const rawVirtualNowMs = progress >= 1
    ? range.endExclusiveMs - ONE_MINUTE_MS
    : range.startMs + Math.floor((range.endExclusiveMs - range.startMs) * progress);
  const virtualNowMs = Math.floor(rawVirtualNowMs / ONE_MINUTE_MS) * ONE_MINUTE_MS;
  const markerMs = progress > 0 && progress < 1 ? Math.max(range.startMs, virtualNowMs - ONE_MINUTE_MS) : virtualNowMs;
  const markerDate = new Date(markerMs);
  const virtualCurrentDay = logicalDayIsoDateForDate(markerDate, input.anchor.startOfDayMinutes);
  const virtualCurrentMinuteOfDay = clampMinuteOfDay(markerDate.getHours() * 60 + markerDate.getMinutes());
  const segments = input.segments.flatMap((segment) => revealedSegment(segment, virtualNowMs));

  return {
    kind: input.anchor.kind,
    progress,
    segments,
    virtualCurrentDay,
    virtualCurrentMinuteOfDay,
    virtualNow: formatLocalDateTime(virtualNowMs),
  };
}

function anchorFor(parts: AnchorParts): DemoDashboardReplayAnchor {
  return {
    kind: parts.kind,
    anchorDay: parts.anchorDay,
    startDay: parts.startDay,
    endDay: parts.endDay,
    rangeStart: formatLocalDateTime(logicalDayStartMs(parts.startDay, parts.startOfDayMinutes)),
    rangeEnd: formatLocalDateTime(logicalDayEndExclusiveMs(parts.endDay, parts.startOfDayMinutes) - 1000),
    startOfDayMinutes: parts.startOfDayMinutes,
  };
}

function blueprintsForKind(kind: DemoDashboardReplayKind): readonly SegmentBlueprint[] {
  switch (kind) {
    case "day":
      return DAY_BLUEPRINTS;
    case "week":
      return WEEK_BLUEPRINTS;
    default:
      return assertNever(kind);
  }
}

function segmentFromBlueprint(anchor: DemoDashboardReplayAnchor, blueprint: SegmentBlueprint, index: number): ActivitySegment {
  const day = shiftIsoDate(anchor.startDay, blueprint[1]);
  const startedAtMs = logicalDayStartMs(day, anchor.startOfDayMinutes) + blueprint[2] * 60 * 1000;
  const endedAtMs = startedAtMs + blueprint[3] * 60 * 1000;
  const site = blueprint[8];
  const siteDomain = site?.[0] ?? null;
  const siteTitle = site?.[1] ?? null;
  const browserName = site ? "Synthetic Browser" : null;

  return {
    id: `demo-${anchor.kind}-${anchor.startDay}-${String(index + 1).padStart(2, "0")}-${blueprint[0]}`,
    startedAt: formatLocalDateTime(startedAtMs),
    endedAt: formatLocalDateTime(endedAtMs),
    durationSeconds: blueprint[3] * 60,
    appName: blueprint[4],
    bundleId: `com.drifty.synthetic.${blueprint[0]}`,
    windowTitle: `Synthetic ${blueprint[4]}`,
    browserName,
    siteDomain,
    siteTitle,
    siteUrl: null,
    siteSource: site ? "window-title" : null,
    platform: "macos",
    source: "manual",
    classification: {
      category: blueprint[5],
      productivity: blueprint[6],
      source: CLASSIFICATION_SOURCE,
      confidence: SYNTHETIC_CONFIDENCE,
      reason: blueprint[7],
    },
  };
}

function revealedSegment(segment: ActivitySegment, virtualNowMs: number): ActivitySegment[] {
  const startedAtMs = new Date(segment.startedAt).getTime();
  const endedAtMs = new Date(segment.endedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs <= startedAtMs || segment.durationSeconds <= 0) {
    return [];
  }

  const revealedEndMs = Math.min(endedAtMs, virtualNowMs);
  if (revealedEndMs <= startedAtMs) return [];

  return [{
    ...segment,
    endedAt: formatLocalDateTime(revealedEndMs),
    durationSeconds: Math.round((revealedEndMs - startedAtMs) / 1000),
  }];
}

function replayRange(anchor: DemoDashboardReplayAnchor): { readonly startMs: number; readonly endExclusiveMs: number } | null {
  const startMs = logicalDayStartMs(anchor.startDay, anchor.startOfDayMinutes);
  const endExclusiveMs = logicalDayEndExclusiveMs(anchor.endDay, anchor.startOfDayMinutes);
  if (!Number.isFinite(startMs) || !Number.isFinite(endExclusiveMs) || endExclusiveMs <= startMs) return null;
  return { startMs, endExclusiveMs };
}

function emptySlice(anchor: DemoDashboardReplayAnchor, progress: number): DemoDashboardReplaySlice {
  return {
    kind: anchor.kind,
    progress,
    segments: [],
    virtualCurrentDay: anchor.startDay,
    virtualCurrentMinuteOfDay: 0,
    virtualNow: anchor.rangeStart,
  };
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function clampMinuteOfDay(minuteOfDay: number): number {
  if (!Number.isFinite(minuteOfDay)) return 0;
  return Math.min(1439, Math.max(0, minuteOfDay));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected demo dashboard replay value: ${String(value)}`);
}
