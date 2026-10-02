import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";
import { buildBreakReturnAlarmEvent, buildDriftAlarmEvent, type DriftAlarmEvent } from "./driftAlarmEvent";
import { buildEndOfDayReviewSummary, type EndOfDayReviewEvent } from "./endOfDayReviewModel";
import { buildMockEndOfDayReviewSegments } from "./endOfDayReviewData";
import { logicalTodayIsoDate } from "../../lib/formatting";
import type { DriftAlarmCopySettingsValue } from "./driftAlarmCopy";
import { buildExtremeNudgeToastCopy } from "./driftAlarmCopy";
import type { DisplayLanguage } from "../localization/languagePreference";
import { translateFor, type Translate } from "../localization/translate";

/** Previews render the user's own wording and language so what they review is what ships. */
export type CompanionPreviewCopyOptions = {
  readonly copySettings?: DriftAlarmCopySettingsValue;
  readonly language?: DisplayLanguage;
};

export const COMPANION_MILESTONE_PREVIEW_OPTIONS = [
  { id: "focus-3h", label: "3h focus" },
  { id: "record-30d", label: "30-day record" },
  { id: "weekly-final-rank-3", label: "Weekly final #3" },
  { id: "weekly-final-rank-2", label: "Weekly final #2" },
  { id: "weekly-final-rank-1", label: "Weekly final #1" },
] as const;

export type CompanionMilestonePreviewId =
  (typeof COMPANION_MILESTONE_PREVIEW_OPTIONS)[number]["id"];

/* Decision cards need to be reviewable without waiting for real drift. These
   previews fire the same events the tracker does. */
export const COMPANION_MOMENT_PREVIEW_OPTIONS = [
  { id: "drift-alarm", label: "Drift alert" },
  { id: "break-return", label: "Break over" },
  { id: "extreme-nudge", label: "Automatic close" },
] as const;

export type CompanionMomentPreviewId =
  (typeof COMPANION_MOMENT_PREVIEW_OPTIONS)[number]["id"];

const PREVIEW_FOCUS_TARGETS = [
  {
    targetId: "com.microsoft.VSCode",
    label: "VS Code",
    detail: "Back to where you were",
    appName: "VS Code",
    bundleId: "com.microsoft.VSCode",
    siteDomain: null,
    siteTitle: null,
    iconSrc: null,
  },
];

export function buildCompanionDriftAlarmPreview(
  previewId: Extract<CompanionMomentPreviewId, "drift-alarm" | "break-return">,
  now = Date.now(),
  petIntercepted = false,
  copy: CompanionPreviewCopyOptions = {},
): DriftAlarmEvent {
  const shared = {
    id: `companion-preview-${previewId}-${now}`,
    contextLabel: "YouTube",
    driftDurationSeconds: 8 * 60,
    preservedFocusStrikeSeconds: 42 * 60,
    generatedAt: new Date(now).toISOString(),
    focusTargets: PREVIEW_FOCUS_TARGETS,
    sourceSiteDomain: "youtube.com",
    sourceAppName: "Safari",
    copySettings: copy.copySettings,
    language: copy.language,
  };

  if (previewId === "break-return") {
    return buildBreakReturnAlarmEvent({
      ...shared,
      breakDurationMinutes: 5,
      pausedFromLabel: "YouTube",
      nextFocusLabel: "VS Code",
    });
  }
  return buildDriftAlarmEvent({ ...shared, petIntercepted });
}

export function buildCompanionExtremeNudgePreview(
  now = Date.now(),
  copy: CompanionPreviewCopyOptions = {},
): ExtremeNudgeToastEvent {
  return {
    kind: "extremeNudgeToast",
    placement: "top-right",
    id: `companion-preview-extreme-nudge-${now}`,
    generatedAt: new Date(now).toISOString(),
    title: copy.copySettings
      ? buildExtremeNudgeToastCopy(copy.copySettings, { closedLabel: "YouTube" }).title
      : "Closed YouTube for you.",
    closedLabel: "YouTube",
    focusLabel: "VS Code",
    breakOptions: [5, 15, 30, 60],
    breakLabel: copy.copySettings?.takeBreakLabel,
    correctionLabel: copy.copySettings?.manualCorrectionLabel,
  };
}

/* The day review is the one moment whose headline had to be re-read against
   real thin days, so it gets the same on-demand treatment as the decision
   cards: the same mock segments the Dev settings preview uses, laid out the
   way the pill renders the automatic evening slot. */
export function buildCompanionDayReviewPreview(now = Date.now()): EndOfDayReviewEvent {
  const day = logicalTodayIsoDate();
  return {
    ...buildEndOfDayReviewSummary({
      day,
      generatedAt: new Date(now).toISOString(),
      segments: buildMockEndOfDayReviewSegments(day),
      isMock: true,
    }),
    layout: "minimal",
  };
}

export function buildCompanionMilestonePreview(
  previewId: CompanionMilestonePreviewId,
  now = Date.now(),
  translate: Translate = translateFor("en"),
): CompanionPillMilestoneEvent {
  const base = { kind: "milestone" as const, id: `companion-preview-${previewId}-${now}` };

  switch (previewId) {
    case "focus-3h":
      return {
        ...base,
        milestoneKind: "total",
        tier: 1,
        title: translate("companion.milestone.day3hTitle"),
        subtitle: translate("companion.milestone.day3hSubtitle"),
        destination: "dashboard",
        /* A preview states the figure it was drawn against, so the headline and
           the number never contradict each other the way live demo data would. */
        statSeconds: 3 * 3600 + 12 * 60,
      };
    case "record-30d":
      return {
        ...base,
        milestoneKind: "record",
        tier: 3,
        title: translate("companion.milestone.recordTitle", { days: 30 }),
        subtitle: translate("companion.milestone.recordFirstSubtitle"),
        destination: "insights",
        statSeconds: 81 * 60,
      };
    case "weekly-final-rank-1":
    case "weekly-final-rank-2":
    case "weekly-final-rank-3": {
      const rank = Number(previewId.slice(-1));
      return {
        ...base,
        milestoneKind: "rank",
        tier: 3,
        title: translate("companion.milestone.leaderboardTitle", { rank }),
        subtitle: translate("companion.milestone.leaderboardSubtitle", { participants: 14 }),
        destination: "leaderboard",
        statSeconds: (16 - rank) * 3600 + 12 * 60,
        statLabel: translate("companion.milestone.statLastWeek"),
      };
    }
  }
}
