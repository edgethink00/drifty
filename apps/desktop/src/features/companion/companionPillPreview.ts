import type { CompanionPillMilestoneEvent } from "./CompanionPillMoment";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";
import type { CompanionReentryEvent } from "./companionReentry";
import { buildBreakReturnAlarmEvent, buildDriftAlarmEvent, type DriftAlarmEvent } from "./driftAlarmEvent";
import { buildEndOfDayReviewSummary, type EndOfDayReviewEvent } from "./endOfDayReviewModel";
import { buildMockEndOfDayReviewSegments } from "./endOfDayReviewData";
import { logicalTodayIsoDate } from "../../lib/formatting";

export const COMPANION_MILESTONE_PREVIEW_OPTIONS = [
  { id: "focus-1h", label: "1h focus" },
  { id: "record-30d", label: "30-day record" },
  { id: "weekly-final-rank-3", label: "Weekly final #3" },
  { id: "weekly-final-rank-2", label: "Weekly final #2" },
  { id: "weekly-final-rank-1", label: "Weekly final #1" },
] as const;

export type CompanionMilestonePreviewId =
  (typeof COMPANION_MILESTONE_PREVIEW_OPTIONS)[number]["id"];

/* The pill grows into four kinds of moment, but only celebrations could be
   summoned on demand, so the three that carry a decision — the ones whose
   spacing and wording matter most — could not be looked at without waiting for
   real drift. These previews fire the same events the tracker does. */
export const COMPANION_MOMENT_PREVIEW_OPTIONS = [
  { id: "drift-alarm", label: "Drift alert" },
  { id: "break-return", label: "Break over" },
  { id: "extreme-nudge", label: "Automatic close" },
  { id: "reentry", label: "Long-break return" },
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

export function buildCompanionExtremeNudgePreview(now = Date.now()): ExtremeNudgeToastEvent {
  return {
    kind: "extremeNudgeToast",
    placement: "top-right",
    id: `companion-preview-extreme-nudge-${now}`,
    generatedAt: new Date(now).toISOString(),
    title: "Closed YouTube for you.",
    closedLabel: "YouTube",
    focusLabel: "VS Code",
    breakOptions: [5, 15, 30, 60],
  };
}

export function buildCompanionReentryPreview(
  now = Date.now(),
  language: "en" | "ko" = "en",
): CompanionReentryEvent {
  const returnedAt = new Date(now);
  const lastActiveAt = new Date(now - (8 * 60 + 12) * 60 * 1000);
  return {
    kind: "reentry",
    id: `companion-preview-reentry-${now}`,
    awaySeconds: 8 * 60 * 60 + 12 * 60,
    lastActiveAt: lastActiveAt.toISOString(),
    returnedAt: returnedAt.toISOString(),
    title: language === "ko" ? "8시간 12분 만에 돌아왔어요" : "Back after 8h 12m",
    subtitle: language === "ko" ? "마지막 활동은 오전 1:18에 끝났어요" : "Last activity ended at 1:18 AM",
    actionLabel: language === "ko" ? "마지막 기록 보기" : "See last session",
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
): CompanionPillMilestoneEvent {
  const base = { kind: "milestone" as const, id: `companion-preview-${previewId}-${now}` };

  switch (previewId) {
    case "focus-1h":
      return {
        ...base,
        milestoneKind: "total",
        tier: 1,
        title: "1 hour of focus",
        subtitle: "A solid hour, captured automatically.",
        destination: "dashboard",
        /* A preview states the figure it was drawn against, so the headline and
           the number never contradict each other the way live demo data would. */
        statSeconds: 62 * 60,
      };
    case "record-30d":
      return {
        ...base,
        milestoneKind: "record",
        tier: 3,
        title: "New 30-day focus record",
        subtitle: "Your strongest focus run this month.",
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
        title: `#${rank} in focus last week`,
        subtitle: `Final rank among 14 active people`,
        destination: "leaderboard",
        statSeconds: (16 - rank) * 3600 + 12 * 60,
        statLabel: "last week",
      };
    }
  }
}
