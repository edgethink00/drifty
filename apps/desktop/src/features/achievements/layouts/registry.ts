import type { AchievementLayoutId } from "../achievementDesignReview";
import { beforeLayout } from "./before";
import { c1Layout } from "./c1";
import { c2Layout } from "./c2";
import { c3Layout } from "./c3";
import { c4Layout } from "./c4";
import { c5Layout } from "./c5";
import { c6Layout } from "./c6";
import { c7Layout } from "./c7";
import { c8Layout } from "./c8";
import { c9Layout } from "./c9";
import { c10Layout } from "./c10";
import { c11Layout } from "./c11";
import { c12Layout } from "./c12";
import { c13Layout } from "./c13";
import { c14Layout } from "./c14";
import { c15Layout } from "./c15";
import { c16Layout } from "./c16";
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
  c7: c7Layout,
  c8: c8Layout,
  c9: c9Layout,
  c10: c10Layout,
  c11: c11Layout,
  c12: c12Layout,
  c13: c13Layout,
  c14: c14Layout,
  c15: c15Layout,
  c16: c16Layout,
};
