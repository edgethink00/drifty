import { describe, expect, it } from "vitest";
import { achievementMilestoneProgress } from "./achievementMilestones";

describe("achievement milestones", () => {
  it("places a count between the milestone reached and the next one", () => {
    expect(achievementMilestoneProgress(22)).toEqual({ reached: 10, target: 25, remaining: 3, share: 0.8 });
    expect(achievementMilestoneProgress(1)).toEqual({ reached: 1, target: 5, remaining: 4, share: 0 });
    expect(achievementMilestoneProgress(5)).toEqual({ reached: 5, target: 10, remaining: 5, share: 0 });
  });

  it("has nothing to show before the first time or past the last milestone", () => {
    expect(achievementMilestoneProgress(0)).toBeNull();
    expect(achievementMilestoneProgress(1000)).toBeNull();
  });
});
