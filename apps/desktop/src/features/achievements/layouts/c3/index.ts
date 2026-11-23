import { spotlightLayout } from "../spotlight";
import type { AchievementLayout } from "../types";

// Placeholder until this layout is built: borrows the spotlight tab and card.
export const c3Layout: AchievementLayout = { ...spotlightLayout, tabLayout: "spotlight", cardLayout: "spotlight" };
