import { describe, expect, it } from "vitest";
import { buildFirstDayRecap } from "./firstDayStory";
import { buildIntroReviewCase } from "./introStoryReview";
import { breakdownCardText, breakdownContent, readingView, rebalancedFixHint, rhythmCardText } from "./noFocusCardVariants";
import { isRebalancedIntroLayout, postOnboardingGuideStepInSequence, POST_ONBOARDING_STORY_REBALANCED_STEPS } from "./postOnboardingSidebarGuide";

const DAY = "2026-09-30", TODAY = "2026-10-01";
const t = (key: string) => ({
  "activity.category.workspace": "Workspace", "activity.category.entertainment": "Entertainment",
  "activity.category.communication": "Communication", "activity.category.utility": "Utility",
  "activity.category.music": "Music",
} as Record<string, string>)[key] ?? key;
const tKo = (key: string) => ({ "activity.category.entertainment": "엔터테인먼트", "activity.category.music": "음악" } as Record<string, string>)[key] ?? key;

describe("rebalanced story review prototype", () => {
  it("keeps six cards: three on the day, the decision, the menu bar ring and the handoff", () => {
    expect(POST_ONBOARDING_STORY_REBALANCED_STEPS).toEqual(["recap", "breakdown", "drift", "account", "tracking", "handoff"]);
    // A step saved under the current story keeps its place in the rebalanced one.
    expect(postOnboardingGuideStepInSequence("activity", POST_ONBOARDING_STORY_REBALANCED_STEPS)).toBe("account");
    expect(isRebalancedIntroLayout("?driftyIntroLayout=rebalanced", true)).toBe(true);
    expect(isRebalancedIntroLayout("?driftyIntroLayout=rebalanced", false)).toBe(false);
  });

  it("picks the middle card by layout, and drops it when the day has nothing for it", () => {
    const focusDay = buildFirstDayRecap({ ...buildIntroReviewCase("story", () => DAY), today: TODAY });
    const dayOff = buildFirstDayRecap({ ...buildIntroReviewCase("noFocus", () => DAY), today: TODAY });
    expect(breakdownContent(focusDay!, "rebalanced")).toBe("kinds");
    expect(breakdownContent(focusDay!, "overview")).toBe("focus");
    // The sample work day has one page worth showing by title, too little to show how Drifty reads.
    expect(breakdownContent(focusDay!, "reading")).toBeNull();
    expect(breakdownContent(dayOff!, "overview")).toBe("reading");
    expect(breakdownCardText(focusDay!, "en", t, "kinds")).toEqual({
      title: "Here it is by kind",
      body: "From the most: workspace 4h 37m, entertainment 1h 26m, and communication 39m.",
    });
    expect(breakdownCardText(dayOff!, "en", t, "reading")).toEqual({
      title: "Drifty reads page titles, not only sites",
      body: "Even on youtube.com, it read 3 pages one by one and sorted them into entertainment and music.",
    });
    expect(breakdownCardText(dayOff!, "ko", tKo, "reading").body).toBe("같은 youtube.com도 페이지 3개를 하나씩 보고 엔터테인먼트와 음악으로 나눴어요.");
    expect(rebalancedFixHint("ko").drift).toContain("‘분류’에서 바로잡을 수 있어요");
  });

  it("goes on with five cards or puts the busiest hours in the middle of a day without focus", () => {
    const focusDay = buildFirstDayRecap({ ...buildIntroReviewCase("story", () => DAY), today: TODAY })!;
    const dayOff = buildFirstDayRecap({ ...buildIntroReviewCase("noFocus", () => DAY), today: TODAY })!;
    // With focus, both follow the day by kind with its focus.
    expect(breakdownContent(focusDay, "five")).toBe("focus");
    expect(breakdownContent(focusDay, "rhythm")).toBe("focus");
    expect(breakdownContent(dayOff, "five")).toBeNull();
    expect(breakdownContent(dayOff, "rhythm")).toBe("rhythm");
    // 10:00-12:00 held mail, Hacker News, the jazz playlist, shopping and the trip plan: 72 minutes.
    expect(rhythmCardText(dayOff, "ko")?.title).toBe("가장 몰린 때는 오전 10시~12시였어요");
    expect(rhythmCardText(dayOff, "ko")?.body).toContain("그중 이 두 시간에 1시간 12분이 몰렸어요.");
    expect(rhythmCardText(dayOff, "en")?.title).toBe("It leaned on 10am–12pm");
  });

  it("names the main kind by a page only when that page stands for a tenth of its time", () => {
    const dayOff = buildFirstDayRecap({ ...buildIntroReviewCase("noFocus", () => DAY), today: TODAY })!;
    expect(readingView(dayOff).rows.map((row) => [row.category, row.title ?? null, row.pages])).toEqual([
      ["entertainment", "Street food tour", 1], ["music", "Morning jazz playlist", 0],
    ]);
    // Sixty short videos over 400 minutes: a 35-minute one does not stand for the rest, so the row counts the pages.
    const site = dayOff.readingSite!;
    const shorts = { ...site, kinds: [{ ...site.kinds[0], seconds: 400 * 60, pageCount: 60 }, ...site.kinds.slice(1)] };
    expect(readingView({ ...dayOff, readingSite: shorts }).rows.map((row) => [row.category, row.title ?? null, row.pages])).toEqual([
      ["entertainment", null, 60], ["music", "Morning jazz playlist", 0],
    ]);
  });
});

