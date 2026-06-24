import { buildHourlySummary, topSites as buildTopSites } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, AppIdentity, HourBucket, ProductivityLabel, SiteDuration, TimelinePage, TimelinePageQuery, TimelineQuery, TrackerStatus } from "@drifty/domain";

type PreviewActivitySegment = ActivitySegment & { category: ActivityCategory; productivity: ProductivityLabel };
type PreviewSegmentSpec = readonly [
  id: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
  overrides?: Partial<PreviewActivitySegment>,
];

const PREVIEW_APP_BUNDLE_IDS: Readonly<Record<string, string>> = {
  Arc: "company.thebrowser.Browser",
  Figma: "com.figma.Desktop",
  Linear: "com.linear",
  Mail: "com.apple.mail",
  Messages: "com.apple.MobileSMS",
  Notion: "notion.id",
  Slack: "com.tinyspeck.slackmacgap",
  Spotify: "com.spotify.client",
  "Visual Studio Code": "com.microsoft.VSCode",
};

const PREVIEW_APP_ICON_SOURCES: Readonly<Record<string, string>> = {
  "com.apple.mail": "./assets/mail-CrE6QGcD.png",
  "com.apple.MobileSMS": "./assets/messages-aYNxSzkK.png",
  "com.figma.Desktop": "https://www.google.com/s2/favicons?domain=figma.com&sz=64",
  "com.linear": "./assets/linear-CuZX2ooj.png",
  "com.microsoft.VSCode": "./assets/visual-studio-code-DW738tZv.png",
  "com.spotify.client": "./assets/spotify-DuyINEyo.ico",
  "com.tinyspeck.slackmacgap": "./assets/slack-BKg3hZEm.png",
  "notion.id": "./assets/notion-CceIbM-j.png",
};

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayIsoDate() {
  return isoDay(new Date());
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return isoDay(date);
}

function at(day: string, hour: number, minute: number) {
  const date = new Date(`${day}T00:00:00`);
  date.setHours(hour, minute, 0, 0);
  return `${isoDay(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
}

function secondsBetween(startedAt: string, endedAt: string) {
  return Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}

function previewBundleId(appName: string) {
  return PREVIEW_APP_BUNDLE_IDS[appName] ?? `com.fixture.${appName.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

function makeSegment(
  id: string,
  day: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
  overrides: Partial<PreviewActivitySegment> = {},
): PreviewActivitySegment {
  const startedAt = at(day, startHour, startMinute);
  const endedAt = at(day, endHour, endMinute);
  const classification: PreviewActivitySegment["classification"] = overrides.classification ?? {
    category,
    productivity,
    source: "manual",
    confidence: 0.96,
    reason: "Preview fixture classification",
    classifiedAt: endedAt,
  };

  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: secondsBetween(startedAt, endedAt),
    appName,
    bundleId: overrides.bundleId ?? previewBundleId(appName),
    windowTitle: overrides.windowTitle ?? null,
    browserName: overrides.browserName ?? null,
    siteDomain: overrides.siteDomain ?? null,
    siteTitle: overrides.siteTitle ?? null,
    category,
    productivity,
    classification,
    platform: "macos",
    source: "manual",
    confidence: 0.96,
    ...overrides,
  };
}

function todaySegments(day: string): PreviewActivitySegment[] {
  const specs: readonly PreviewSegmentSpec[] = [
    ["preview-t1", 9, 27, 9, 30, "Mail", "communication", "neutral", { windowTitle: "Inbox" }],
    ["preview-t2", 9, 51, 10, 0, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "calendar.google.com", siteTitle: "Daily plan" }],
    ["preview-t3", 10, 0, 10, 15, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "calendar.google.com", siteTitle: "Daily plan" }],
    ["preview-t4", 10, 15, 10, 18, "Visual Studio Code", "workspace", "focus", { windowTitle: "DashboardPage.tsx" }],
    ["preview-t5", 10, 18, 10, 24, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Pull request #284" }],
    ["preview-t6", 10, 30, 10, 36, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Review checks" }],
    ["preview-t7", 10, 36, 10, 42, "Slack", "communication", "neutral", { windowTitle: "#design-engineering" }],
    ["preview-t8", 10, 42, 10, 48, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Review checks" }],
    ["preview-t9", 10, 48, 10, 57, "Visual Studio Code", "workspace", "focus", { windowTitle: "FlowChartView.tsx" }],
    ["preview-t10", 11, 15, 11, 42, "Visual Studio Code", "workspace", "focus", { windowTitle: "FlowChartView.tsx" }],
    ["preview-t11", 11, 42, 11, 54, "Figma", "workspace", "focus", { windowTitle: "Homepage crop options" }],
    ["preview-t12", 11, 54, 12, 0, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "linear.app", siteTitle: "Dashboard polish" }],
    ["preview-t13", 12, 0, 12, 9, "Figma", "workspace", "focus", { windowTitle: "Homepage crop options" }],
    ["preview-t14", 12, 9, 12, 33, "Visual Studio Code", "workspace", "focus", { windowTitle: "previewData.ts" }],
    ["preview-t15", 12, 33, 12, 42, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "linear.app", siteTitle: "Dashboard polish" }],
    ["preview-t16", 12, 42, 13, 0, "Visual Studio Code", "workspace", "focus", { windowTitle: "previewData.ts" }],
    ["preview-t17", 13, 0, 13, 12, "Visual Studio Code", "workspace", "focus", { windowTitle: "previewData.ts" }],
    ["preview-t18", 13, 30, 13, 42, "Visual Studio Code", "workspace", "focus", { windowTitle: "AppUsagePanel.tsx" }],
    ["preview-t19", 13, 42, 14, 0, "Figma", "workspace", "focus", { windowTitle: "Category rhythm" }],
    ["preview-t20", 14, 0, 14, 24, "Visual Studio Code", "workspace", "focus", { windowTitle: "AppUsagePanel.tsx" }],
    ["preview-t21", 14, 24, 14, 33, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t22", 14, 33, 15, 0, "Visual Studio Code", "workspace", "focus", { windowTitle: "AppUsagePanel.tsx" }],
    ["preview-t23", 15, 0, 15, 27, "Figma", "workspace", "focus", { windowTitle: "Dashboard QA" }],
    ["preview-t24", 15, 27, 15, 36, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "react.dev", siteTitle: "Grid layout" }],
    ["preview-t25", 15, 36, 15, 45, "Messages", "communication", "neutral", { windowTitle: "Min" }],
    ["preview-t26", 15, 45, 15, 54, "Visual Studio Code", "workspace", "focus", { windowTitle: "DashboardPage.tsx" }],
    ["preview-t27", 15, 54, 16, 0, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Actions run" }],
    ["preview-t28", 16, 0, 16, 18, "Visual Studio Code", "workspace", "focus", { windowTitle: "DashboardPage.tsx" }],
    ["preview-t29", 16, 18, 16, 27, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t30", 16, 27, 16, 30, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Actions run" }],
    ["preview-t31", 16, 30, 16, 36, "Linear", "workspace", "focus", { windowTitle: "Triage visual regressions" }],
    ["preview-t32", 18, 39, 18, 45, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "drifty.so", siteTitle: "Homepage preview" }],
    ["preview-t33", 18, 45, 19, 0, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t34", 19, 0, 19, 18, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t35", 19, 18, 19, 30, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Visual QA" }],
    ["preview-t36", 19, 30, 19, 36, "Linear", "workspace", "focus", { windowTitle: "Demo follow-up" }],
    ["preview-t37", 19, 36, 19, 51, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Visual QA" }],
    ["preview-t38", 19, 51, 20, 0, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t39", 20, 0, 20, 9, "Figma", "workspace", "focus", { windowTitle: "Flow silhouette" }],
    ["preview-t40", 20, 9, 20, 30, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Visual QA" }],
    ["preview-t41", 20, 30, 20, 39, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t42", 20, 39, 20, 51, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Visual QA" }],
    ["preview-t43", 20, 51, 21, 0, "Slack", "communication", "neutral", { windowTitle: "#launch-room" }],
    ["preview-t44", 21, 0, 21, 9, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Visual QA" }],
    ["preview-t45", 21, 9, 21, 21, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t46", 21, 21, 21, 45, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "linear.app", siteTitle: "Visual QA" }],
    ["preview-t47", 21, 45, 21, 51, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Launch replies" }],
    ["preview-t48", 21, 51, 22, 0, "Visual Studio Code", "workspace", "focus", { windowTitle: "Homepage demo" }],
    ["preview-t49", 22, 0, 22, 27, "Visual Studio Code", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t50", 22, 27, 22, 45, "Figma", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t51", 22, 45, 23, 0, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "linear.app", siteTitle: "QA notes" }],
    ["preview-t52", 23, 0, 23, 12, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t53", 23, 12, 23, 24, "Visual Studio Code", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t54", 23, 24, 23, 33, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "linear.app", siteTitle: "QA notes" }],
    ["preview-t55", 23, 33, 23, 42, "Visual Studio Code", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t56", 23, 42, 23, 54, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t57", 23, 54, 24, 0, "Visual Studio Code", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t58", 24, 0, 24, 18, "Figma", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t59", 24, 18, 24, 30, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "linear.app", siteTitle: "QA notes" }],
    ["preview-t60", 24, 30, 24, 42, "Visual Studio Code", "workspace", "focus", { windowTitle: "Demo polish" }],
    ["preview-t61", 25, 0, 25, 24, "Visual Studio Code", "workspace", "focus", { windowTitle: "Late review" }],
    ["preview-t62", 25, 24, 25, 33, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Late review" }],
    ["preview-t63", 25, 33, 25, 45, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t64", 25, 45, 26, 0, "Figma", "workspace", "focus", { windowTitle: "Late review" }],
    ["preview-t65", 26, 0, 26, 12, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t66", 26, 12, 26, 30, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Late review" }],
    ["preview-t67", 26, 30, 26, 45, "Messages", "communication", "neutral", { windowTitle: "Min" }],
    ["preview-t68", 26, 45, 27, 0, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Late review" }],
    ["preview-t69", 27, 0, 27, 12, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Late review" }],
    ["preview-t70", 27, 12, 27, 18, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "developer.apple.com", siteTitle: "App review notes" }],
    ["preview-t71", 27, 18, 27, 42, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
    ["preview-t72", 27, 42, 28, 0, "Arc", "utility", "neutral", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Late review" }],
  ];
  return specs.map(([id, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides]) =>
    makeSegment(id, day, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides),
  );
}

function weekSegments(today: string): PreviewActivitySegment[] {
  const plans: ReadonlyArray<readonly [offset: number, segments: readonly PreviewSegmentSpec[]]> = [
    [1, [
      ["thu-mail", 8, 48, 9, 3, "Mail", "communication", "neutral", { windowTitle: "Investor updates" }],
      ["thu-code-a", 9, 8, 10, 22, "Visual Studio Code", "workspace", "focus", { windowTitle: "billingService.ts" }],
      ["thu-github", 10, 25, 10, 54, "Arc", "workspace", "focus", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Review billing entitlement PR" }],
      ["thu-slack", 11, 6, 11, 22, "Slack", "communication", "neutral", { windowTitle: "#launch-room" }],
      ["thu-figma", 13, 2, 14, 18, "Figma", "workspace", "focus", { windowTitle: "Pricing empty states" }],
      ["thu-linear", 14, 26, 14, 49, "Linear", "workspace", "focus", { windowTitle: "DTM-231 · AI setup copy" }],
      ["thu-code-b", 15, 4, 16, 36, "Visual Studio Code", "workspace", "focus", { windowTitle: "AiSetupPanel.tsx" }],
      ["thu-youtube", 17, 28, 18, 2, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "WWDC recaps" }],
    ]],
    [2, [
      ["wed-notion", 8, 55, 9, 24, "Notion", "workspace", "focus", { windowTitle: "Release checklist" }],
      ["wed-code-a", 9, 32, 10, 46, "Visual Studio Code", "workspace", "focus", { windowTitle: "WeekDashboard.tsx" }],
      ["wed-docs", 10, 52, 11, 18, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "docs.rs", siteTitle: "tauri-plugin-store" }],
      ["wed-spotify", 12, 16, 12, 48, "Spotify", "music", "neutral", { windowTitle: "Deep Focus" }],
      ["wed-code-b", 13, 5, 14, 12, "Visual Studio Code", "workspace", "focus", { windowTitle: "previewData.ts" }],
      ["wed-slack", 14, 24, 14, 44, "Slack", "communication", "neutral", { windowTitle: "Design QA thread" }],
      ["wed-figma", 15, 9, 16, 2, "Figma", "workspace", "focus", { windowTitle: "Homepage crop options" }],
      ["wed-x", 17, 6, 17, 32, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Launch replies" }],
    ]],
    [3, [
      ["tue-mail", 8, 35, 8, 58, "Mail", "communication", "neutral", { windowTitle: "Feedback digest" }],
      ["tue-figma", 9, 14, 10, 18, "Figma", "workspace", "focus", { windowTitle: "Cloud connected state" }],
      ["tue-code-a", 10, 26, 11, 37, "Visual Studio Code", "workspace", "focus", { windowTitle: "DashboardAiUnavailableNotice.tsx" }],
      ["tue-github", 11, 40, 12, 7, "Arc", "workspace", "focus", { browserName: "Arc", siteDomain: "github.com", siteTitle: "Actions run #842" }],
      ["tue-messages", 13, 2, 13, 16, "Messages", "communication", "neutral", { windowTitle: "Min" }],
      ["tue-linear", 13, 30, 14, 16, "Linear", "workspace", "focus", { windowTitle: "Triage visual regressions" }],
      ["tue-code-b", 14, 28, 15, 42, "Visual Studio Code", "workspace", "focus", { windowTitle: "flowHoverGroups.ts" }],
      ["tue-reddit", 17, 35, 18, 4, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "reddit.com", siteTitle: "r/tauri" }],
    ]],
    [4, [
      ["mon-notion", 8, 50, 9, 20, "Notion", "workspace", "focus", { windowTitle: "Weekly plan" }],
      ["mon-code-a", 9, 28, 10, 52, "Visual Studio Code", "workspace", "focus", { windowTitle: "classificationViewData.ts" }],
      ["mon-slack", 11, 10, 11, 31, "Slack", "communication", "neutral", { windowTitle: "#product" }],
      ["mon-stack", 11, 36, 12, 3, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "stackoverflow.com", siteTitle: "CSS grid sticky rail" }],
      ["mon-code-b", 13, 12, 14, 38, "Visual Studio Code", "workspace", "focus", { windowTitle: "AppUsagePanel.tsx" }],
      ["mon-figma", 15, 2, 15, 46, "Figma", "workspace", "focus", { windowTitle: "Week calendar density" }],
      ["mon-youtube", 17, 41, 18, 16, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "Desk setup review" }],
    ]],
    [5, [
      ["sun-docs", 10, 25, 11, 18, "Arc", "learning", "focus", { browserName: "Arc", siteDomain: "developer.apple.com", siteTitle: "App icon guidelines" }],
      ["sun-spotify", 12, 40, 13, 18, "Spotify", "music", "neutral", { windowTitle: "Sunday reset" }],
      ["sun-youtube", 14, 22, 15, 8, "Arc", "entertainment", "drift", { browserName: "Arc", siteDomain: "youtube.com", siteTitle: "Camera reviews" }],
    ]],
    [6, [
      ["sat-mail", 9, 45, 10, 6, "Mail", "communication", "neutral", { windowTitle: "Newsletter skim" }],
      ["sat-linear", 10, 22, 11, 4, "Linear", "workspace", "focus", { windowTitle: "Backlog pruning" }],
      ["sat-x", 13, 20, 13, 58, "Arc", "social_media", "drift", { browserName: "Arc", siteDomain: "x.com", siteTitle: "Weekend scroll" }],
    ]],
  ];
  return plans.flatMap(([offset, specs]) => {
    const day = shiftDay(today, -offset);
    return specs.map(([id, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides]) =>
      makeSegment(`preview-w${offset}-${id}`, day, startHour, startMinute, endHour, endMinute, appName, category, productivity, overrides),
    );
  });
}

function historySegments(today: string): PreviewActivitySegment[] {
  const segments: PreviewActivitySegment[] = [];
  for (let offset = 7; offset <= 60; offset += 1) {
    const day = shiftDay(today, -offset);
    const weekday = new Date(`${day}T12:00:00`).getDay();
    if (weekday === 0 || weekday === 6) {
      if (offset % 3 !== 0) {
        segments.push(makeSegment(`preview-h${offset}a`, day, 10, 20, 11, 30, "Arc", "learning", "focus", { siteDomain: "react.dev", browserName: "Arc" }));
        segments.push(makeSegment(`preview-h${offset}b`, day, 14, 15, 15, 5, "Arc", "entertainment", "drift", { siteDomain: "youtube.com", browserName: "Arc" }));
      }
    } else {
      const extraMinutes = (offset * 7) % 28;
      segments.push(makeSegment(`preview-h${offset}a`, day, 9, 10, 12, 5 + extraMinutes, "Visual Studio Code", "workspace", "focus"));
      segments.push(makeSegment(`preview-h${offset}b`, day, 13, 20, 16, 30, "Visual Studio Code", "workspace", "focus"));
      segments.push(makeSegment(`preview-h${offset}c`, day, 16, 35, 17, 20, "Slack", "communication", "neutral"));
      if (offset % 2 === 0) {
        segments.push(makeSegment(`preview-h${offset}d`, day, 17, 30, 18, 15, "Arc", "social_media", "drift", { siteDomain: "x.com", browserName: "Arc" }));
      }
    }
  }
  return segments;
}

function previewSegments(today = todayIsoDate()) {
  return [...todaySegments(today), ...weekSegments(today), ...historySegments(today)];
}

function inRange(segment: PreviewActivitySegment, query: TimelineQuery) {
  if ("day" in query && query.day) return segment.startedAt.slice(0, 10) === query.day;
  const startedAt = new Date(segment.startedAt).getTime();
  const start = "start" in query && query.start ? new Date(query.start).getTime() : Number.NEGATIVE_INFINITY;
  const end = "end" in query && query.end ? new Date(query.end).getTime() : Number.POSITIVE_INFINITY;
  return startedAt >= start && startedAt <= end;
}

export function previewStatus(): TrackerStatus {
  return {
    running: true,
    accessibilityGranted: true,
    lastEventAt: at(todayIsoDate(), 18, 40),
    databasePath: "browser-preview",
    trackerMode: "preview",
    idleSeconds: 0,
    idleDetectionAvailable: true,
    message: "Browser preview data",
  };
}

export function previewTimeline(query: TimelineQuery): ActivitySegment[] {
  return previewSegments().filter((segment) => inRange(segment, query));
}

export function previewTimelinePage(query: TimelinePageQuery): TimelinePage {
  const limit = clampTimelinePageLimit(query.limit);
  const beforeEndedAtMs = query.beforeEndedAt ? Date.parse(query.beforeEndedAt) : null;
  const beforeSegmentId = query.beforeSegmentId ?? null;
  const rows = previewSegments()
    .filter((segment) => inTimelinePageRange(segment, query))
    .filter((segment) => {
      if (beforeEndedAtMs === null || !Number.isFinite(beforeEndedAtMs) || beforeSegmentId === null) return true;
      const endedAtMs = Date.parse(segment.endedAt);
      return endedAtMs < beforeEndedAtMs || (endedAtMs === beforeEndedAtMs && segment.id < beforeSegmentId);
    })
    .sort(compareTimelinePageSegmentsDescending);
  const pageRows = rows.slice(0, limit);
  const items = [...pageRows].reverse();
  const hasMore = rows.length > limit;
  const cursorRow = hasMore ? pageRows[pageRows.length - 1] : null;
  return {
    items,
    hasMore,
    nextCursor: cursorRow
      ? {
          beforeEndedAt: cursorRow.endedAt,
          beforeSegmentId: cursorRow.id,
        }
      : null,
  };
}

export function previewHourlySummary(query: TimelineQuery): HourBucket[] {
  return buildHourlySummary(previewTimeline(query));
}

export function previewTopSites(query: TimelineQuery & { limit?: number }): SiteDuration[] {
  return buildTopSites(previewTimeline(query), query.limit ?? 5);
}

export function previewAppIcons(apps: AppIdentity[]): AppIconMap {
  return apps.reduce<AppIconMap>((acc, app) => {
    const key = app.bundleId || app.appName;
    const iconSrc = PREVIEW_APP_ICON_SOURCES[key] ?? PREVIEW_APP_ICON_SOURCES[previewBundleId(app.appName)] ?? null;
    acc[key] = iconSrc;
    acc[app.appName] = iconSrc;
    return acc;
  }, {});
}

export function shouldUsePreviewData() {
  if (typeof window === "undefined") return false;
  if ("__TAURI_INTERNALS__" in window) return false;
  if (import.meta.env.VITE_DRIFTY_PREVIEW === "1") return true;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("driftyPreview") === "1") return true;
  try {
    const previewValue = window.localStorage.getItem("drifty.preview");
    if (previewValue === "1") return true;
  } catch {
    return false;
  }
  return false;
}

function clampTimelinePageLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 200;
  return Math.min(500, Math.max(1, Math.floor(limit)));
}

function inTimelinePageRange(segment: PreviewActivitySegment, query: TimelinePageQuery): boolean {
  if (query.day) return segment.startedAt.slice(0, 10) === query.day;
  const startedAt = new Date(segment.startedAt).getTime();
  const start = query.start ? new Date(query.start).getTime() : Number.NEGATIVE_INFINITY;
  const end = query.end ? new Date(query.end).getTime() : Number.POSITIVE_INFINITY;
  return startedAt >= start && startedAt <= end;
}

function compareTimelinePageSegmentsDescending(left: ActivitySegment, right: ActivitySegment): number {
  const endedAtDelta = Date.parse(right.endedAt) - Date.parse(left.endedAt);
  if (endedAtDelta !== 0) return endedAtDelta;
  return right.id.localeCompare(left.id);
}
