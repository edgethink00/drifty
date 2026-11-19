/**
 * Pill geometry, measured against the prototype.
 *
 * The dedicated native companion panel resizes to these exact dimensions for
 * each state, so its AppKit hit area stays aligned with the visible capsule.
 */
export type CompanionPillState =
  | "collapsed"
  | "peek"
  | "milestone"
  | "milestoneCard"
  | "breakCard"
  | "noteCard"
  | "drift"
  | "nudge"
  | "eod"
  | "eodPending"
  | "eodCompact"
  | "eodMinimal";

export type CompanionDayReviewLayout = "full" | "compact" | "minimal";

export type CompanionPillSize = { width: number; height: number };
export type CompanionHorizontalAnchor = "left" | "center" | "right";

export const COMPANION_PILL_SIZES: Record<CompanionPillState, CompanionPillSize> = {
  collapsed: { width: 220, height: 28.9 },
  /* Kept for bridge compatibility; the resident UI no longer enters hover peek. */
  peek: { width: 220, height: 28.9 },
  milestone: { width: 410, height: 54 },
  /* Weekly first place: an illustrated trophy above the headline. */
  milestoneCard: { width: 300, height: 143 },
  /* A focus session card with one action (a break's Skip break, the end's
     오늘 보기): the drift card's width, a title, a line and the action
     (CompanionMilestoneCard). */
  breakCard: { width: 352, height: 100 },
  /* The next pomodoro round: the same card with no action. */
  noteCard: { width: 352, height: 68 },
  drift: { width: 352, height: 130 },
  nudge: { width: 352, height: 130 },
  /* The clean 72px productivity ring removes 16px of unused outer-disc
     height while preserving the same edge and footer rhythm. */
  eod: { width: 331, height: 480 },
  eodPending: { width: 331, height: 300 },
  /* The head row is two stacked slabs (Focus / Longest streak) with a caption
     line each, 22px taller than the single Work-hours slab it replaced. */
  eodCompact: { width: 310, height: 306 },
  eodMinimal: { width: 310, height: 245 },
};

export function resolveCompanionHorizontalAnchor({
  capsuleCenterX,
  targetCapsuleWidth,
  screenLeft,
  screenWidth,
}: {
  capsuleCenterX: number;
  targetCapsuleWidth: number;
  screenLeft: number;
  screenWidth: number;
}): CompanionHorizontalAnchor {
  const centeredLeft = capsuleCenterX - targetCapsuleWidth / 2;
  const centeredRight = capsuleCenterX + targetCapsuleWidth / 2;
  if (centeredLeft < screenLeft) return "left";
  if (centeredRight > screenLeft + screenWidth) return "right";
  return "center";
}
