import type { AchievementLayoutId } from "../achievementDesignReview";
import { c12Layout } from "./c12";
import { c13Layout } from "./c13";
import { c14Layout } from "./c14";
import { c15Layout } from "./c15";
import { c16Layout } from "./c16";
import type { AchievementLayout } from "./types";

export const ACHIEVEMENT_LAYOUT_REGISTRY: Readonly<Record<AchievementLayoutId, AchievementLayout>> = {
  c12: c12Layout,
  c13: c13Layout,
  c14: c14Layout,
  c15: c15Layout,
  c16: c16Layout,
};
