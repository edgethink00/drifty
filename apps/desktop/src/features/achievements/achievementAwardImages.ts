import type { AchievementId } from "./achievementCatalog";
import comeback from "./assets/awards/comeback.webp";
import driftDay from "./assets/awards/driftDay.webp";
import earlyStart from "./assets/awards/earlyStart.webp";
import firstFlow from "./assets/awards/firstFlow.webp";
import flow180 from "./assets/awards/flow180.webp";
import flow90 from "./assets/awards/flow90.webp";
import focus100h from "./assets/awards/focus100h.webp";
import focusDay8h from "./assets/awards/focusDay8h.webp";
import hidden from "./assets/awards/hidden.webp";
import nightOwl from "./assets/awards/nightOwl.webp";
import noDriftDay from "./assets/awards/noDriftDay.webp";
import streak30 from "./assets/awards/streak30.webp";
import streak7 from "./assets/awards/streak7.webp";
import weekendShift from "./assets/awards/weekendShift.webp";

/**
 * One sculpted award per achievement, plus the sealed medal shown for a hidden
 * achievement until it is earned. 512 px renders with transparency; a locked
 * award is the same picture drained of colour in CSS.
 */
export const ACHIEVEMENT_AWARD_IMAGES: Readonly<Record<AchievementId | "hidden", string>> = {
  firstFlow, flow90, flow180, focusDay8h,
  earlyStart, nightOwl, weekendShift,
  streak7, streak30, focus100h,
  driftDay, noDriftDay, comeback,
  hidden,
};
