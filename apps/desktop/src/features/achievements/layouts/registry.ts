import type { AchievementLayoutId } from "../achievementDesignReview";
import { beforeLayout } from "./before";
import { c1Layout } from "./c1";
import { c2Layout } from "./c2";
import { c3Layout } from "./c3";
import { c4Layout } from "./c4";
import { c5Layout } from "./c5";
import { c6Layout } from "./c6";
import { spotlightLayout } from "./spotlight";
import type { AchievementLayout } from "./types";

export const ACHIEVEMENT_LAYOUT_REGISTRY: Readonly<Record<AchievementLayoutId, AchievementLayout>> = {
  before: beforeLayout,
  spotlight: spotlightLayout,
  c1: c1Layout,
  c2: c2Layout,
  c3: c3Layout,
  c4: c4Layout,
  c5: c5Layout,
  c6: c6Layout,
};
