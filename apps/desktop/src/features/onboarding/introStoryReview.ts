import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";

/** Synthetic browser-history day for the tutorial story and empty-data fallback only. */
export const INTRO_REVIEW_DATA_QUERY_PARAM = "driftyIntroData";

type Entry = readonly [startHour: number, startMinute: number, minutes: number, domain: string, title: string, category: ActivityCategory, productivity: ProductivityLabel];

// A designer-developer's Wednesday as Chrome history: a morning of docs and code review, a long
// afternoon stretch on GitHub, and YouTube in the gaps and the evening.
const ENTRIES: readonly Entry[] = [
  [9, 12, 14, "mail.google.com", "Inbox", "communication", "neutral"],
  [9, 26, 22, "docs.google.com", "Q4 planning", "workspace", "focus"],
  [9, 48, 9, "youtube.com", "YouTube", "entertainment", "drift"],
  [9, 57, 33, "figma.com", "Onboarding v3", "workspace", "focus"],
  [10, 30, 6, "x.com", "Home / X", "social_media", "drift"],
  [10, 36, 41, "github.com", "Pull requests", "workspace", "focus"],
  [11, 17, 18, "linear.app", "Sprint board", "workspace", "focus"],
  [11, 35, 12, "slack.com", "Slack", "communication", "neutral"],
  [11, 47, 16, "youtube.com", "YouTube", "entertainment", "drift"],
  [13, 20, 11, "news.ycombinator.com", "Hacker News", "social_media", "drift"],
  [13, 31, 25, "notion.so", "Design notes", "workspace", "focus"],
  [13, 56, 6, "slack.com", "Slack", "communication", "neutral"],
  [14, 2, 30, "github.com", "drifty / onboarding", "workspace", "focus"],
  [14, 32, 4, "stackoverflow.com", "CSS grid", "learning", "focus"],
  [14, 36, 30, "github.com", "drifty / onboarding", "workspace", "focus"],
  [15, 6, 21, "youtube.com", "YouTube", "entertainment", "drift"],
  [15, 27, 26, "figma.com", "Onboarding v3", "workspace", "focus"],
  [15, 53, 7, "mail.google.com", "Inbox", "communication", "neutral"],
  [16, 0, 28, "docs.google.com", "Launch checklist", "workspace", "focus"],
  [16, 28, 8, "x.com", "Home / X", "social_media", "drift"],
  [16, 36, 24, "github.com", "Issues", "workspace", "focus"],
  [17, 10, 10, "coupang.com", "Coupang", "shopping", "drift"],
  [21, 5, 26, "youtube.com", "YouTube", "entertainment", "drift"],
  [21, 31, 14, "netflix.com", "Netflix", "entertainment", "drift"],
];

/**
 * classifiedCount: how many entries (in a fixed scattered order) already carry a classification, so
 * the review can play classification arriving. The rest are stored as unknown, which reads as pending.
 */
export function buildFirstDayReviewSegments(day: string, classifiedCount = ENTRIES.length): ActivitySegment[] {
  const order = ENTRIES.map((_, index) => index).sort((left, right) => ((left * 7) % ENTRIES.length) - ((right * 7) % ENTRIES.length));
  const classified = new Set(order.slice(0, Math.max(0, classifiedCount)));
  return ENTRIES.map(([hour, minute, minutes, domain, title, category, productivity], index) => {
    const startedAt = new Date(day + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00");
    const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
    return {
      id: "first-day-review-" + index,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: minutes * 60,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: domain,
      siteTitle: title,
      siteUrl: "https://" + domain + "/",
      windowTitle: title,
      platform: "macos",
      source: "browser-history-import",
      siteSource: "browser-history-import",
      classification: classified.has(index)
        ? { category, productivity, source: "llm", confidence: 0.9, aiResult: true, reason: "First-day review fixture" }
        : { category: "unknown", productivity: "neutral", source: "llm", confidence: 0, aiResult: true, reason: "First-day review fixture (pending)" },
    } as ActivitySegment;
  });
}

export const FIRST_DAY_REVIEW_ENTRY_COUNT = ENTRIES.length;

/**
 * Review cases for the story cards (?driftyIntroData=): story (yesterday, rebuilt from browser history),
 * today (the prepared day is today: the story says so far today), earlier (the day before, only partly imported: the sample cards), watched (recorded by the tracker, so no rebuilt
 * note), mixed (part watched, part rebuilt: no note), appDrift (the top drift is an app), lowDrift (2 min
 * of drift), noDrift, lowFocus (22 min of focus: the story opens on the time it read), short (too little
 * to tell: the sample cards), empty.
 */
export type IntroReviewDataMode = "story" | "today" | "earlier" | "watched" | "mixed" | "appDrift" | "lowDrift" | "noDrift" | "lowFocus" | "short" | "empty";
const REVIEW_MODES: readonly IntroReviewDataMode[] = ["story", "today", "earlier", "watched", "mixed", "appDrift", "lowDrift", "noDrift", "lowFocus", "short", "empty"];
export function introReviewDataMode(search: string): IntroReviewDataMode {
  const mode = new URLSearchParams(search).get(INTRO_REVIEW_DATA_QUERY_PARAM);
  return REVIEW_MODES.find((candidate) => candidate === mode) ?? "story";
}

/** The review day offset (0 = today) and segments for one review case. */
export function buildIntroReviewCase(mode: IntroReviewDataMode, dayFor: (offset: number) => string): { readonly day: string; readonly segments: ActivitySegment[] } {
  const offset = mode === "today" ? 0 : mode === "earlier" ? -2 : -1;
  const day = dayFor(offset);
  if (mode === "empty") return { day, segments: [] };
  let segments = buildFirstDayReviewSegments(day);
  const drift = (segment: ActivitySegment) => segment.classification?.productivity === "drift";
  if (mode === "noDrift") segments = segments.filter((segment) => !drift(segment));
  if (mode === "lowDrift") {
    segments = segments.filter((segment, index) => !drift(segment) || index === 2);
    segments = segments.map((segment, index) => index === 2
      ? { ...segment, durationSeconds: 120, endedAt: new Date(Date.parse(segment.startedAt) + 120_000).toISOString() } : segment);
  }
  if (mode === "short") segments = segments.filter((_, index) => index === 0 || index === 2);
  // Only the morning's Q4 planning doc stays focus: 22 minutes, the rest of the work reads as neutral.
  if (mode === "lowFocus") segments = segments.map((segment) => segment.classification?.productivity === "focus" && segment.siteTitle !== "Q4 planning"
    ? { ...segment, classification: { ...segment.classification, productivity: "neutral" } } satisfies ActivitySegment : segment);
  if (mode === "mixed") segments = segments.map((segment, index) => index % 2 === 0 ? { ...segment, source: "nsworkspace", siteSource: "applescript" } satisfies ActivitySegment : segment);
  if (mode === "appDrift") segments = segments.map((segment) => segment.siteDomain === "youtube.com"
    ? { ...segment, appName: "Steam", bundleId: "com.valvesoftware.steam", browserName: null, siteDomain: null, siteTitle: null, siteUrl: null, windowTitle: "Steam", source: "nsworkspace", siteSource: null } satisfies ActivitySegment
    : segment);
  if (mode === "watched") segments = segments.map((segment) => ({ ...segment, source: "nsworkspace", siteSource: "applescript" }) satisfies ActivitySegment);
  return { day, segments };
}


const REVIEW_SITES = [
  "github.com", "youtube.com", "figma.com", "docs.google.com", "mail.google.com", "notion.so", "linear.app",
  "slack.com", "x.com", "news.ycombinator.com", "stackoverflow.com", "coupang.com", "netflix.com",
] as const;

/**
 * Real favicons for the browser review only, loaded from a public favicon service. The packaged app
 * resolves the same icons through its native on-disk cache and never uses this.
 */
export function buildFirstDayReviewSiteIcons(): Record<string, string> {
  return Object.fromEntries(REVIEW_SITES.map((domain) => [domain, "https://www.google.com/s2/favicons?sz=64&domain=" + domain]));
}
