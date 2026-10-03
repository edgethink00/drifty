import type { ActivityCategory, ActivitySegment, AppIconMap, ProductivityLabel } from "@drifty/domain";

/** Synthetic records for the preparation review only. No real activity is used. */
export const FIRST_DAY_REVIEW_QUERY_PARAM = "driftyFirstDayReview";

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
export function buildFirstDayReviewSegments(day: string, classifiedCount = ENTRIES.length, sources: "sites" | "mixed" = "sites"): ActivitySegment[] {
  const order = ENTRIES.map((_, index) => index).sort((left, right) => ((left * 7) % ENTRIES.length) - ((right * 7) % ENTRIES.length));
  const classified = new Set(order.slice(0, Math.max(0, classifiedCount)));
  return ENTRIES.map(([hour, minute, minutes, domain, title, category, productivity], index) => {
    const startedAt = new Date(day + "T" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":00");
    const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
    const app = sources === "mixed" ? REVIEW_APP_ENTRIES[index] : undefined;
    return {
      id: "first-day-review-" + index,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: minutes * 60,
      appName: app?.appName ?? "Google Chrome",
      bundleId: app?.bundleId ?? "com.google.Chrome",
      browserName: app ? null : "Google Chrome",
      siteDomain: app ? null : domain,
      siteTitle: app ? null : title,
      siteUrl: app ? null : "https://" + domain + "/",
      windowTitle: title,
      platform: "macos",
      source: app ? "native-app" : "browser-history-import",
      siteSource: app ? null : "browser-history-import",
      classification: classified.has(index)
        ? { category, productivity, source: "llm", confidence: 0.9, aiResult: true, reason: "First-day review fixture" }
        : { category: "unknown", productivity: "neutral", source: "llm", confidence: 0, aiResult: true, reason: "First-day review fixture (pending)" },
    } as ActivitySegment;
  });
}

export const FIRST_DAY_REVIEW_ENTRY_COUNT = ENTRIES.length;

// Development fixture only. These replace a few site entries with native-app activity; they never
// imply that a first browser-history import can recover native-app history.
const REVIEW_APPS = [
  { appName: "Xcode", bundleId: "com.apple.dt.Xcode", file: "xcode.png" },
  { appName: "Obsidian", bundleId: "md.obsidian", file: "obsidian.png" },
  { appName: "Mail", bundleId: "com.apple.mail", file: "mail.png" },
  { appName: "Terminal", bundleId: "com.apple.Terminal", file: "terminal.png" },
] as const;
const REVIEW_APP_ENTRIES: Readonly<Record<number, typeof REVIEW_APPS[number]>> = {
  0: REVIEW_APPS[2], 5: REVIEW_APPS[0], 10: REVIEW_APPS[1],
  12: REVIEW_APPS[0], 14: REVIEW_APPS[0], 18: REVIEW_APPS[3], 20: REVIEW_APPS[0],
};

/** Dev review receives its extracted native icon assets from the task's capture server. */
export function buildFirstDayReviewAppIcons(iconBase: string | null): AppIconMap {
  if (!iconBase) return {};
  try {
    const base = new URL(iconBase);
    if (base.protocol !== "http:" && base.protocol !== "https:") return {};
    return Object.fromEntries(REVIEW_APPS.map((app) => [app.bundleId, new URL(app.file, base).href]));
  } catch { return {}; }
}

export function isFirstDayReviewEnabled(search: string, isDevelopment: boolean): boolean {
  return isDevelopment && new URLSearchParams(search).get(FIRST_DAY_REVIEW_QUERY_PARAM) === "1";
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
