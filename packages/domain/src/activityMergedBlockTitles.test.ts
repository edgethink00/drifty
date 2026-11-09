import { describe, expect, it } from "vitest";
import { buildMergedBlockTitlePrompt, mergedBlockTitleKey, parseMergedBlockTitle } from "./activityMergedBlockTitles";

const cards = [
  { title: "Food and gaming Shorts", minutes: 56 },
  { title: "YouTube short-video feed", minutes: 54 },
  { title: "Music and esports clips", minutes: 53 },
  { title: "Crit Neeko top video", minutes: 10 },
];

describe("merged block titles", () => {
  it("keys the same cards the same way in any order, and apart by language", () => {
    expect(mergedBlockTitleKey(["w1:c1", "w2:c1"], "en")).toBe(mergedBlockTitleKey(["w2:c1", "w1:c1", "w1:c1"], "en"));
    expect(mergedBlockTitleKey(["w1:c1", "w2:c1"], "en")).not.toBe(mergedBlockTitleKey(["w1:c1", "w2:c1"], "ko"));
  });

  it("sends only the cards' titles and minutes, in time order", () => {
    const prompt = buildMergedBlockTitlePrompt(cards, "en");
    expect(prompt).toContain("1. Food and gaming Shorts (56 min)");
    expect(prompt).toContain("4. Crit Neeko top video (10 min)");
    expect(prompt).toContain("Write in English.");
  });

  it("accepts a short name built from the cards' words", () => {
    expect(parseMergedBlockTitle('{"title": "YouTube Shorts and esports clips."}', cards)).toBe("YouTube Shorts and esports clips");
  });

  it("refuses a name that adds what the cards did not say, runs long, or is not JSON", () => {
    expect(parseMergedBlockTitle('{"title": "Relaxing with friends on Netflix"}', cards)).toBeNull();
    expect(parseMergedBlockTitle('{"title": "Three hours of YouTube Shorts"}', cards)).toBeNull();
    expect(parseMergedBlockTitle('{"title": "Food gaming Shorts YouTube feed music esports clips video"}', cards)).toBeNull();
    expect(parseMergedBlockTitle("YouTube Shorts", cards)).toBeNull();
  });
  it("refuses one card's name for a stretch that card holds under 40% of", () => {
    expect(parseMergedBlockTitle('{"title": "Crit Neeko top video"}', cards)).toBeNull();
    expect(parseMergedBlockTitle('{"title": "Food and gaming Shorts"}', [{ title: "Food and gaming Shorts", minutes: 30 }, { title: "Music clips", minutes: 20 }])).toBe("Food and gaming Shorts");
  });
  it("refuses a name that only names the block's apps", () => {
    const work = [{ title: "Aside, ChatGPT, Slack and Meet use", minutes: 32 }, { title: "ChatGPT and Dayflow app use", minutes: 14 }, { title: "Drifty site and review research", minutes: 10 }];
    expect(parseMergedBlockTitle('{"title": "ChatGPT use"}', work, ["ChatGPT", "Aside", "Slack"])).toBeNull();
    expect(parseMergedBlockTitle('{"title": "Drifty site and review research"}', [{ title: "Drifty site and review research", minutes: 30 }, { title: "ChatGPT use", minutes: 10 }], ["ChatGPT"])).toBe("Drifty site and review research");
  });
});
