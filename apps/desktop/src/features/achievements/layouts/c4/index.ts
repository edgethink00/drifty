import { spotlightLayout } from "../spotlight";
import type { AchievementLayout } from "../types";

// Placeholder until this layout is built: borrows the spotlight tab and card.
export const c4Layout: AchievementLayout = { ...spotlightLayout, tabLayout: "spotlight", cardLayout: "spotlight" };
