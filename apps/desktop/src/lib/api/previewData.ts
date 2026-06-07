import type { ActivityCategory, ActivitySegment, AppIconMap, AppIdentity, HourBucket, ProductivityLabel, SiteDuration, TimelineQuery, TrackerStatus } from "@drifty/domain";

type PreviewActivitySegment = ActivitySegment & { category: ActivityCategory; productivity: ProductivityLabel };
import { buildHourlySummary, topSites as buildTopSites } from "@drifty/domain";

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
  return {
    id,
    startedAt,
    endedAt,
    durationSeconds: secondsBetween(startedAt, endedAt),
    appName,
    bundleId: overrides.bundleId ?? `com.fixture.${appName.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    windowTitle: overrides.windowTitle ?? null,
    browserName: overrides.browserName ?? null,
    siteDomain: overrides.siteDomain ?? null,
    siteTitle: overrides.siteTitle ?? null,
    category,
    productivity,
    platform: "macos",
    source: "manual",
    confidence: 0.96,
    ...overrides,
  };
}

function todaySegments(day: string): PreviewActivitySegment[] {
  return [
    makeSegment("preview-t1", day, 8, 42, 8, 58, "Slack", "communication", "neutral", { windowTitle: "#design-engineering" }),
    makeSegment("preview-t2", day, 9, 2, 9, 18, "Mail", "communication", "neutral", { windowTitle: "Inbox" }),
    makeSegment("preview-t3", day, 9, 21, 10, 33, "Visual Studio Code", "workspace", "focus", { windowTitle: "App.tsx — Drifty" }),
    makeSegment("preview-t4", day, 10, 34, 10, 41, "Slack", "communication", "neutral", { windowTitle: "#design-engineering" }),
    makeSegment("preview-t5", day, 10, 42, 11, 56, "Visual Studio Code", "workspace", "focus", { windowTitle: "styles.css — Drifty" }),
    makeSegment("preview-t6", day, 11, 56, 12, 14, "Arc", "workspace", "focus", { siteDomain: "github.com", siteTitle: "Pull request #284", browserName: "Arc", windowTitle: "github.com/drifty/desktop · PR #284" }),
    makeSegment("preview-t7", day, 12, 15, 12, 28, "Arc", "learning", "focus", { siteDomain: "stackoverflow.com", siteTitle: "How to type useMemo result", browserName: "Arc" }),
    makeSegment("preview-t8", day, 12, 30, 12, 58, "Spotify", "music", "neutral", { windowTitle: "Lo-fi beats" }),
    makeSegment("preview-t9", day, 12, 32, 13, 5, "Arc", "social_media", "drift", { siteDomain: "x.com", siteTitle: "X — Home", browserName: "Arc" }),
    makeSegment("preview-t10", day, 13, 8, 13, 14, "Messages", "communication", "neutral", { windowTitle: "Maria" }),
    makeSegment("preview-t11", day, 13, 22, 14, 41, "Visual Studio Code", "workspace", "focus", { windowTitle: "FlowChartView.tsx" }),
    makeSegment("preview-t12", day, 14, 42, 14, 51, "Arc", "learning", "focus", { siteDomain: "react.dev", siteTitle: "useMemo – React", browserName: "Arc" }),
    makeSegment("preview-t13", day, 14, 52, 15, 38, "Visual Studio Code", "workspace", "focus", { windowTitle: "FlowChartView.tsx" }),
    makeSegment("preview-t14", day, 15, 39, 15, 47, "Slack", "communication", "neutral", { windowTitle: "#standups" }),
    makeSegment("preview-t15", day, 15, 48, 16, 12, "Figma", "workspace", "focus", { windowTitle: "Drifty — Insights v3" }),
    makeSegment("preview-t16", day, 16, 12, 16, 33, "Linear", "workspace", "focus", { windowTitle: "DTM-208 · Leaderboard ranks" }),
    makeSegment("preview-t17", day, 16, 33, 17, 12, "Visual Studio Code", "workspace", "focus", { windowTitle: "LeaderboardView.tsx" }),
    makeSegment("preview-t18", day, 17, 13, 17, 32, "Arc", "workspace", "focus", { siteDomain: "github.com", siteTitle: "PR review · #284", browserName: "Arc" }),
    makeSegment("preview-t19", day, 17, 52, 18, 21, "Arc", "entertainment", "drift", { siteDomain: "youtube.com", siteTitle: "MKBHD — phone reviews", browserName: "Arc" }),
    makeSegment("preview-t20", day, 18, 23, 18, 40, "Arc", "social_media", "drift", { siteDomain: "reddit.com", siteTitle: "r/programming", browserName: "Arc" }),
  ];
}

function weekSegments(today: string): PreviewActivitySegment[] {
  const segments: PreviewActivitySegment[] = [];
  const intensities = [0.7, 0.85, 0.6, 0.95, 0.5, 0.3];
  for (let offset = 1; offset <= 6; offset += 1) {
    const day = shiftDay(today, -offset);
    const intensity = intensities[offset - 1] ?? 0.6;
    if (intensity > 0.4) {
      segments.push(makeSegment(`preview-w${offset}a`, day, 9, 5, 11, 30, "Visual Studio Code", "workspace", "focus"));
      segments.push(makeSegment(`preview-w${offset}b`, day, 11, 35, 12, 12, "Arc", "workspace", "focus", { siteDomain: "github.com", browserName: "Arc" }));
      segments.push(makeSegment(`preview-w${offset}c`, day, 13, 15, 14, 40, "Visual Studio Code", "workspace", "focus"));
      segments.push(makeSegment(`preview-w${offset}d`, day, 14, 45, 15, 10, "Slack", "communication", "neutral"));
      segments.push(makeSegment(`preview-w${offset}e`, day, 15, 15, 16, 50 + Math.round(intensity * 60), "Figma", "workspace", "focus"));
    }
    if (intensity > 0.5) {
      segments.push(makeSegment(`preview-w${offset}f`, day, 17, 30, 18, Math.round(intensity * 60), "Arc", "entertainment", "drift", { siteDomain: "youtube.com", browserName: "Arc" }));
    }
    segments.push(makeSegment(`preview-w${offset}g`, day, 8, 30, 8, 55, "Mail", "communication", "neutral"));
  }
  return segments;
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

export function previewHourlySummary(query: TimelineQuery): HourBucket[] {
  return buildHourlySummary(previewTimeline(query));
}

export function previewTopSites(query: TimelineQuery & { limit?: number }): SiteDuration[] {
  return buildTopSites(previewTimeline(query), query.limit ?? 5);
}

export function previewAppIcons(apps: AppIdentity[]): AppIconMap {
  return apps.reduce<AppIconMap>((acc, app) => {
    const key = app.bundleId || app.appName;
    acc[key] = null;
    acc[app.appName] = null;
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
