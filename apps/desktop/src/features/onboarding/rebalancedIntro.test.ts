import { describe, expect, it } from "vitest";
import { buildFirstDayRecap } from "./firstDayStory";
import { buildIntroReviewCase } from "./introStoryReview";
import { breakdownCardText, rebalancedFixHint } from "./noFocusCardVariants";
import { isRebalancedIntroLayout, postOnboardingGuideStepInSequence, POST_ONBOARDING_STORY_REBALANCED_STEPS } from "./postOnboardingSidebarGuide";

const DAY = "2026-09-30", TODAY = "2026-10-01";
const t = (key: string) => ({
  "activity.category.workspace": "Workspace", "activity.category.entertainment": "Entertainment",
  "activity.category.communication": "Communication", "activity.category.utility": "Utility",
  "activity.category.music": "Music",
} as Record<string, string>)[key] ?? key;

describe("rebalanced story review prototype", () => {
  it("keeps six cards: three on the day, the decision, the menu bar ring and the handoff", () => {
    expect(POST_ONBOARDING_STORY_REBALANCED_STEPS).toEqual(["recap", "breakdown", "drift", "account", "tracking", "handoff"]);
    // A step saved under the current story keeps its place in the rebalanced one.
    expect(postOnboardingGuideStepInSequence("activity", POST_ONBOARDING_STORY_REBALANCED_STEPS)).toBe("account");
    expect(isRebalancedIntroLayout("?driftyIntroLayout=rebalanced", true)).toBe(true);
    expect(isRebalancedIntroLayout("?driftyIntroLayout=rebalanced", false)).toBe(false);
  });

  it("shows the day by kind after a focus opening, and the titles Drifty read after a day opened by kind", () => {
    const focusDay = buildFirstDayRecap({ ...buildIntroReviewCase("story", () => DAY), today: TODAY });
    expect(breakdownCardText(focusDay!, "en", t)).toEqual({
      title: "Here it is by kind",
      body: "From the most: workspace 4h 37m, entertainment 1h 26m, and communication 39m.",
    });
    const dayOff = buildFirstDayRecap({ ...buildIntroReviewCase("noFocus", () => DAY), today: TODAY });
    expect(breakdownCardText(dayOff!, "en", t)).toEqual({
      title: "Drifty reads page titles, not only sites",
      body: "Even on youtube.com, it read “Street food tour” as entertainment and “Morning jazz playlist” as music.",
    });
    expect(rebalancedFixHint("ko").drift).toContain("‘분류’에서 바로잡을 수 있어요");
  });
});

