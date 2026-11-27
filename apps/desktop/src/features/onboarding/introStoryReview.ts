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

// A day off as Chrome history: mail and messages, a trip being planned, some shopping, and videos and
// Netflix in the evening. Nothing in it is focus; it is what a first day with no focus looks like.
const NO_FOCUS_ENTRIES: readonly Entry[] = [
  [9, 40, 18, "mail.google.com", "Inbox", "communication", "neutral"],
  [10, 5, 12, "news.ycombinator.com", "Hacker News", "social_media", "drift"],
  [10, 20, 24, "youtube.com", "Morning jazz playlist", "music", "neutral"],
  [11, 0, 16, "coupang.com", "Running shoes", "shopping", "drift"],
  [11, 20, 20, "notion.so", "Jeju trip plan", "utility", "neutral"],
  [13, 10, 35, "youtube.com", "Street food tour", "entertainment", "drift"],
  [14, 0, 22, "slack.com", "Slack", "communication", "neutral"],
  [14, 30, 15, "x.com", "Home / X", "social_media", "drift"],
  [15, 0, 28, "notion.so", "Jeju trip plan", "utility", "neutral"],
  [16, 10, 14, "coupang.com", "Cart", "shopping", "drift"],
  [20, 30, 40, "netflix.com", "Netflix", "entertainment", "drift"],
  [21, 15, 26, "youtube.com", "Movie review", "entertainment", "drift"],
  [22, 0, 10, "instagram.com", "Instagram", "social_media", "drift"],
];

/**
 * classifiedCount: how many entries (in a fixed scattered order) already carry a classification, so
 * the review can play classification arriving. The rest are stored as unknown, which reads as pending.
 */
export function buildFirstDayReviewSegments(day: string, classifiedCount = ENTRIES.length): ActivitySegment[] {
  return reviewSegmentsFrom(ENTRIES, day, classifiedCount);
}

function reviewSegmentsFrom(entries: readonly Entry[], day: string, classifiedCount = entries.length): ActivitySegment[] {
  const order = entries.map((_, index) => index).sort((left, right) => ((left * 7) % entries.length) - ((right * 7) % entries.length));
  const classified = new Set(order.slice(0, Math.max(0, classifiedCount)));
  return entries.map(([hour, minute, minutes, domain, title, category, productivity], index) => {
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
 * today (the prepared day is today: the story says so far today), earlier (the day before yesterday, whole in the 72-hour import), watched (recorded by the tracker, so no rebuilt
 * note), mixed (part watched, part rebuilt: no note), appDrift (the top drift is an app), lowDrift (2 min
 * of drift), noDrift, lowFocus (22 min of focus: the story opens on the time it read), noFocus (no focus:
 * the story names where the time went), short (too little to tell: the sample cards), empty.
 */
export type IntroReviewDataMode = "story" | "today" | "earlier" | "watched" | "mixed" | "appDrift" | "lowDrift" | "noDrift" | "lowFocus" | "noFocus" | "short" | "empty";
const REVIEW_MODES: readonly IntroReviewDataMode[] = ["story", "today", "earlier", "watched", "mixed", "appDrift", "lowDrift", "noDrift", "lowFocus", "noFocus", "short", "empty"];
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
  if (mode === "noFocus") segments = reviewSegmentsFrom(NO_FOCUS_ENTRIES, day);
  if (mode === "mixed") segments = segments.map((segment, index) => index % 2 === 0 ? { ...segment, source: "nsworkspace", siteSource: "applescript" } satisfies ActivitySegment : segment);
  if (mode === "appDrift") segments = segments.map((segment) => segment.siteDomain === "youtube.com"
    ? { ...segment, appName: "Steam", bundleId: "com.valvesoftware.steam", browserName: null, siteDomain: null, siteTitle: null, siteUrl: null, windowTitle: "Steam", source: "nsworkspace", siteSource: null } satisfies ActivitySegment
    : segment);
  if (mode === "watched") segments = segments.map((segment) => ({ ...segment, source: "nsworkspace", siteSource: "applescript" }) satisfies ActivitySegment);
  return { day, segments };
}


const REVIEW_SITES = [
  "github.com", "youtube.com", "figma.com", "docs.google.com", "mail.google.com", "notion.so", "linear.app",
  "slack.com", "x.com", "news.ycombinator.com", "stackoverflow.com", "coupang.com", "netflix.com", "instagram.com",
] as const;

/**
 * Real favicons for the browser review only, loaded from a public favicon service. The packaged app
 * resolves the same icons through its native on-disk cache and never uses this.
 */
export function buildFirstDayReviewSiteIcons(): Record<string, string> {
  return Object.fromEntries(REVIEW_SITES.map((domain) => [domain, "https://www.google.com/s2/favicons?sz=64&domain=" + domain]));
}

/**
 * Dev server only: ?driftyIntroData=file&driftyIntroFile=<absolute path> reads one day of real records
 * from a local JSON file ({ day, segments }) through Vite's /@fs route, so a reviewer can see the story on
 * their own data. The file never leaves the reviewer's machines; nothing is committed or uploaded.
 */
export const INTRO_REVIEW_FILE_QUERY_PARAM = "driftyIntroFile";
export function introReviewDataFile(search: string): string | null {
  const params = new URLSearchParams(search);
  const path = params.get(INTRO_REVIEW_FILE_QUERY_PARAM);
  if (params.get(INTRO_REVIEW_DATA_QUERY_PARAM) !== "file" || !path || !path.startsWith("/") || !path.endsWith(".json")) return null;
  return "/@fs" + path;
}

