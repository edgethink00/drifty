// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  MIN_DAYS_SINCE_FIRST_RUN,
  MIN_TRACKED_SECONDS,
  daysSinceFirstRun,
  hadProblemToday,
  markGitHubStarProblemDay,
  readGitHubStarPreview,
  settingsGitHubLinkShown,
  starCardDue,
  summarizeTrackedHistory,
  type GitHubStarAvailability,
  type StarCardInput,
} from "./githubStar";

const open: GitHubStarAvailability = { public: true, stars: 10, star: "not_starred" };
const ready: StarCardInput = {
  availability: open,
  usage: { trackedSeconds: 30 * 3600 },
  daysSinceFirstRun: MIN_DAYS_SINCE_FIRST_RUN,
  done: false,
  organizationSeat: false,
  healthy: true,
  problemToday: false,
};

describe("starCardDue", () => {
  it("asks someone who came back after the first day, on a good day", () => {
    expect(starCardDue(ready)).toBe(true);
  });

  it("never asks while the repository is private or once starred", () => {
    expect(starCardDue({ ...ready, availability: { ...open, public: false } })).toBe(false);
    expect(starCardDue({ ...ready, availability: null })).toBe(false);
    expect(starCardDue({ ...ready, availability: { ...open, star: "starred" } })).toBe(false);
  });

  it("asks without gh too: gh only decides how the button stars", () => {
    expect(starCardDue({ ...ready, availability: { ...open, star: "unavailable" } })).toBe(true);
  });

  it("waits for an hour on record, so the title has hours to name", () => {
    expect(starCardDue({ ...ready, usage: { trackedSeconds: MIN_TRACKED_SECONDS - 1 } })).toBe(false);
    expect(starCardDue({ ...ready, usage: null })).toBe(false);
  });

  it("never asks on the first day, however much history the first-day preparation imported", () => {
    expect(starCardDue({ ...ready, daysSinceFirstRun: MIN_DAYS_SINCE_FIRST_RUN - 1 })).toBe(false);
  });

  it("never asks someone on an organization's seat", () => {
    expect(starCardDue({ ...ready, organizationSeat: true })).toBe(false);
  });

  it("stays away on a day with a recording or AI problem", () => {
    expect(starCardDue({ ...ready, healthy: false })).toBe(false);
    expect(starCardDue({ ...ready, problemToday: true })).toBe(false);
  });

  it("stops for good once answered", () => {
    expect(starCardDue({ ...ready, done: true })).toBe(false);
  });
});

describe("settingsGitHubLinkShown", () => {
  it("is a standing link once public, starred or not, except on an organization's seat", () => {
    expect(settingsGitHubLinkShown(open, false)).toBe(true);
    expect(settingsGitHubLinkShown({ ...open, star: "starred" }, false)).toBe(true);
    expect(settingsGitHubLinkShown({ ...open, public: false }, false)).toBe(false);
    expect(settingsGitHubLinkShown(null, false)).toBe(false);
    expect(settingsGitHubLinkShown(open, true)).toBe(false);
  });
});

describe("daysSinceFirstRun", () => {
  afterEach(() => window.localStorage.clear());
  it("starts the clock on the first check and counts whole days after it", () => {
    expect(daysSinceFirstRun(new Date(2026, 10, 20, 9))).toBe(0);
    expect(daysSinceFirstRun(new Date(2026, 10, 22, 8))).toBe(1);
    expect(daysSinceFirstRun(new Date(2026, 10, 23, 9))).toBe(3);
  });
});

describe("summarizeTrackedHistory", () => {
  it("adds up recorded time", () => {
    expect(summarizeTrackedHistory([
      { hour: "2026-11-17T09:00:00", totalSeconds: 1800 },
      { hour: "2026-11-17T10:00:00", totalSeconds: 3600 },
      { hour: "2026-11-18T09:00:00", totalSeconds: 0 },
      { hour: "2026-11-19T14:00:00", totalSeconds: 600 },
    ])).toEqual({ trackedSeconds: 6000 });
  });
});

describe("problem day", () => {
  afterEach(() => window.localStorage.clear());
  it("remembers today's problem only for today", () => {
    markGitHubStarProblemDay(new Date(2026, 10, 19, 9));
    expect(hadProblemToday(new Date(2026, 10, 19, 22))).toBe(true);
    expect(hadProblemToday(new Date(2026, 10, 20, 9))).toBe(false);
  });
});

describe("readGitHubStarPreview", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));
  it("is off without the review parameter", () => {
    expect(readGitHubStarPreview()).toBeNull();
  });
  it("reads the review gates", () => {
    window.history.replaceState(null, "", "/?githubStarPreview=gh&githubStarDays=2&githubStarSeat=org&githubStarHealthy=0");
    const preview = readGitHubStarPreview();
    expect(preview?.daysSinceFirstRun).toBe(2);
    expect(preview?.organizationSeat).toBe(true);
    expect(preview?.healthy).toBe(false);
  });
});

