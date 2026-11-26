import type { ActivityCategory, ActivitySegment } from "@drifty/domain";

/** A classified record between two local clock times. */
export function homeSegment(day: string, from: string, to: string, productivity: "focus" | "drift" | "neutral", extra: Partial<ActivitySegment> = {}): ActivitySegment {
  const startedAt = day + "T" + from + ":00";
  let endDay = day;
  if (to < from) {
    const next = new Date(day + "T12:00:00");
    next.setDate(next.getDate() + 1);
    endDay = next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0") + "-" + String(next.getDate()).padStart(2, "0");
  }
  const endedAt = endDay + "T" + to + ":00";
  const category: ActivityCategory = productivity === "focus" ? "workspace" : productivity === "drift" ? "entertainment" : "communication";
  return {
    id: startedAt + "-" + productivity + "-" + (extra.windowTitle ?? extra.siteDomain ?? ""),
    startedAt,
    endedAt,
    durationSeconds: (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    appName: "Visual Studio Code",
    windowTitle: "",
    platform: "macos",
    source: "nsworkspace",
    classification: { category, productivity, source: "manual", confidence: 1, reason: "fixture" },
    ...extra,
  } as ActivitySegment;
}

export const TODAY = "2026-11-05"; // a Thursday

/**
 * Four earlier Thursdays with 2h of focus before noon, yesterday with two
 * titled pieces of work, and today with 2h35m of focus before 11:35.
 */
export function homeFixture(): ActivitySegment[] {
  const segments: ActivitySegment[] = [];
  for (const day of ["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]) {
    segments.push(homeSegment(day, "09:00", "11:00", "focus", { windowTitle: "plan.md" }));
    segments.push(homeSegment(day, "11:00", "11:20", "drift", { appName: "Arc", siteDomain: "youtube.com" }));
    segments.push(homeSegment(day, "13:00", "15:00", "focus", { windowTitle: "plan.md" }));
  }
  // Yesterday (Wednesday): billing.ts most, Pricing last.
  segments.push(homeSegment("2026-11-04", "09:05", "11:05", "focus", { windowTitle: "billing.ts" }));
  segments.push(homeSegment("2026-11-04", "11:10", "11:40", "drift", { appName: "Arc", siteDomain: "x.com" }));
  segments.push(homeSegment("2026-11-04", "15:00", "16:00", "focus", { appName: "Figma", windowTitle: "Pricing empty states" }));
  // Monday and Tuesday this week: the longest focus also starts in the 9 o'clock hour.
  segments.push(homeSegment("2026-11-02", "09:10", "10:40", "focus", { windowTitle: "week.ts" }));
  segments.push(homeSegment("2026-11-03", "09:20", "10:30", "focus", { windowTitle: "week.ts" }));
  // Today.
  segments.push(homeSegment(TODAY, "09:00", "11:35", "focus", { appName: "Figma", windowTitle: "Home v2" }));
  segments.push(homeSegment(TODAY, "11:40", "12:00", "drift", { appName: "Arc", siteDomain: "youtube.com" }));
  segments.push(homeSegment(TODAY, "13:00", "18:30", "focus", { windowTitle: "HomePage.tsx" }));
  return segments;
}

export function at(day: string, clock: string): number {
  return new Date(day + "T" + clock + ":00").getTime();
}

