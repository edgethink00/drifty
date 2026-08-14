import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";

import {
  DRIFT_ALARM_SESSION_EXIT_GRACE_MS,
  DRIFT_ALARM_SESSION_HARD_CAP_MS,
  DRIFT_ALARM_SESSION_REENTRY_GRACE_MS,
  advanceDriftAlarmSessionProtection,
  armDriftAlarmSessionProtection,
  createDriftAlarmSessionProtection,
  driftAlarmSessionSuppressionReason,
  isDriftAlarmSessionProtected,
} from "./driftAlarmSessionProtection";

const START_MS = Date.UTC(2026, 7, 14, 9, 0, 0, 0);

describe("drift alarm session protection", () => {
  it("protects different URLs on the same browser and domain", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://www.instagram.com/reel/AAA/"),
      START_MS,
    );

    expect(protection).not.toBeNull();
    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("reel-b", "https://www.instagram.com/reel/BBB/"),
    )).toBe(true);
  });

  it("does not protect another domain or browser", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://www.instagram.com/reel/AAA/"),
      START_MS,
    );

    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("youtube", "https://www.youtube.com/watch?v=1", { siteDomain: "youtube.com" }),
    )).toBe(false);
    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("safari-reel", "https://www.instagram.com/reel/BBB/", { appName: "Safari", browserName: "Safari", bundleId: "com.apple.Safari" }),
    )).toBe(false);
  });

  it("uses a normalized URL host when the captured domain is missing", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://www.instagram.com/reel/AAA/", { siteDomain: null }),
      START_MS,
    );

    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/", { siteDomain: null }),
    )).toBe(true);
  });

  it("uses a valid URL host when the captured domain is malformed", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://www.instagram.com/reel/AAA/", { siteDomain: "://invalid" }),
      START_MS,
    );

    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/", { siteDomain: null }),
    )).toBe(true);
  });

  it("keeps site protection narrow when browser metadata is temporarily missing", () => {
    const source = browserSegment("reel-a", "https://instagram.com/reel/AAA/", { browserName: null });
    const protection = createDriftAlarmSessionProtection(source, START_MS);

    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/", { browserName: null }),
    )).toBe(true);
    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("youtube", "https://youtube.com/watch?v=1", { browserName: null, siteDomain: "youtube.com" }),
    )).toBe(false);
  });

  it("matches the browser name when one sample is missing a bundle id", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://instagram.com/reel/AAA/", { bundleId: null }),
      START_MS,
    );

    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/"),
    )).toBe(true);
  });

  it("does not let a shared display name override conflicting bundle ids", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://instagram.com/reel/AAA/"),
      START_MS,
    );

    expect(isDriftAlarmSessionProtected(
      protection,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/", { bundleId: "com.example.other-browser" }),
    )).toBe(false);
  });

  it("does not arm a browser-wide protection without a reliable site", () => {
    const protection = createDriftAlarmSessionProtection({
      ...browserSegment("unknown", "", { siteDomain: null }),
      siteUrl: null,
    }, START_MS);

    expect(protection).toBeNull();
  });

  it("recognizes a known browser when all browser and site metadata is degraded", () => {
    const protection = createDriftAlarmSessionProtection({
      ...browserSegment("degraded-chrome", "", {
        browserName: null,
        siteDomain: null,
      }),
      siteUrl: null,
    }, START_MS);

    expect(protection).toBeNull();
  });

  it("keeps an existing protection when a new correction has no safe surface", () => {
    const existing = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://instagram.com/reel/AAA/"),
      START_MS,
    );
    const unsafeBrowserCorrection = {
      ...browserSegment("unknown", "", { siteDomain: null }),
      siteUrl: null,
    };

    expect(armDriftAlarmSessionProtection(
      existing,
      unsafeBrowserCorrection,
      START_MS + 1_000,
    )).toBe(existing);
  });

  it("falls back to bundle identity for non-browser applications", () => {
    const source = appSegment("steam-store", "Steam Store");
    const protection = createDriftAlarmSessionProtection(source, START_MS);

    expect(isDriftAlarmSessionProtected(protection, appSegment("steam-library", "Library"))).toBe(true);
    expect(isDriftAlarmSessionProtected(protection, {
      ...appSegment("other", "Store"),
      bundleId: "com.example.other",
    })).toBe(false);
  });

  it("falls back to the app name when a non-browser bundle id is blank", () => {
    const source = { ...appSegment("steam-store", "Steam Store"), bundleId: "   " };
    const protection = createDriftAlarmSessionProtection(source, START_MS);

    expect(isDriftAlarmSessionProtected(
      protection,
      { ...appSegment("steam-library", "Library"), bundleId: null },
    )).toBe(true);
  });

  it("allows a closed Extreme Nudge surface to re-enter within five minutes", () => {
    const source = browserSegment("reel-a", "https://instagram.com/reel/AAA/");
    const protection = createDriftAlarmSessionProtection(source, START_MS);
    const whileAway = advanceDriftAlarmSessionProtection(
      protection,
      appSegment("notes", "Notes"),
      START_MS + DRIFT_ALARM_SESSION_REENTRY_GRACE_MS - 1,
    );
    const reentered = advanceDriftAlarmSessionProtection(
      whileAway,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/"),
      START_MS + DRIFT_ALARM_SESSION_REENTRY_GRACE_MS - 1,
    );

    expect(whileAway?.phase).toBe("armed");
    expect(reentered?.phase).toBe("active");
  });

  it("expires an armed protection when the surface does not return in five minutes", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://instagram.com/reel/AAA/"),
      START_MS,
    );

    expect(advanceDriftAlarmSessionProtection(
      protection,
      appSegment("notes", "Notes"),
      START_MS + DRIFT_ALARM_SESSION_REENTRY_GRACE_MS,
    )).toBeNull();
  });

  it("does not reactivate from a matching sample at the re-entry deadline", () => {
    const source = browserSegment("reel-a", "https://instagram.com/reel/AAA/");
    const protection = createDriftAlarmSessionProtection(source, START_MS);

    expect(advanceDriftAlarmSessionProtection(
      protection,
      source,
      START_MS + DRIFT_ALARM_SESSION_REENTRY_GRACE_MS,
    )).toBeNull();
  });

  it("keeps an active protection across a brief excursion and resets the exit clock on return", () => {
    const source = browserSegment("reel-a", "https://instagram.com/reel/AAA/");
    const armed = createDriftAlarmSessionProtection(source, START_MS);
    const active = advanceDriftAlarmSessionProtection(armed, source, START_MS + 1);
    const away = advanceDriftAlarmSessionProtection(
      active,
      appSegment("notes", "Notes"),
      START_MS + 1_000,
    );
    const returned = advanceDriftAlarmSessionProtection(
      away,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/"),
      START_MS + DRIFT_ALARM_SESSION_EXIT_GRACE_MS - 1,
    );

    expect(away?.leftAtMs).toBe(START_MS + 1_000);
    expect(returned).toMatchObject({ phase: "active", leftAtMs: null });
  });

  it("ends an active protection after two continuous minutes elsewhere", () => {
    const source = browserSegment("reel-a", "https://instagram.com/reel/AAA/");
    const armed = createDriftAlarmSessionProtection(source, START_MS);
    const active = advanceDriftAlarmSessionProtection(armed, source, START_MS + 1);
    const leftAtMs = START_MS + 1_000;
    const away = advanceDriftAlarmSessionProtection(active, appSegment("notes", "Notes"), leftAtMs);

    expect(advanceDriftAlarmSessionProtection(
      away,
      appSegment("notes", "Notes"),
      leftAtMs + DRIFT_ALARM_SESSION_EXIT_GRACE_MS,
    )).toBeNull();
  });

  it("does not revive protection when the surface returns after two minutes away", () => {
    const source = browserSegment("reel-a", "https://instagram.com/reel/AAA/");
    const armed = createDriftAlarmSessionProtection(source, START_MS);
    const active = advanceDriftAlarmSessionProtection(armed, source, START_MS + 1);
    const leftAtMs = START_MS + 1_000;
    const away = advanceDriftAlarmSessionProtection(active, appSegment("notes", "Notes"), leftAtMs);

    expect(advanceDriftAlarmSessionProtection(
      away,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/"),
      leftAtMs + DRIFT_ALARM_SESSION_EXIT_GRACE_MS,
    )).toBeNull();
  });

  it("enforces the sixty-minute hard cap even without an activity sample", () => {
    const protection = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://instagram.com/reel/AAA/"),
      START_MS,
    );

    expect(advanceDriftAlarmSessionProtection(
      protection,
      null,
      START_MS + DRIFT_ALARM_SESSION_HARD_CAP_MS,
    )).toBeNull();
  });

  it("uses an expired protection only for a stale candidate from the protected surface", () => {
    const expired = createDriftAlarmSessionProtection(
      browserSegment("reel-a", "https://instagram.com/reel/AAA/"),
      START_MS,
    );

    expect(driftAlarmSessionSuppressionReason(
      null,
      expired,
      browserSegment("reel-b", "https://instagram.com/reel/BBB/"),
    )).toBe("manual_session_protection_expiry_guard");
    expect(driftAlarmSessionSuppressionReason(
      null,
      expired,
      browserSegment("youtube", "https://youtube.com/watch?v=1", { siteDomain: "youtube.com" }),
    )).toBeNull();
  });
});

function browserSegment(
  id: string,
  siteUrl: string,
  overrides: Partial<ActivitySegment> = {},
): ActivitySegment {
  return {
    id,
    startedAt: "2026-08-14T09:00:00.000Z",
    endedAt: "2026-08-14T09:01:00.000Z",
    durationSeconds: 60,
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    windowTitle: "Instagram",
    browserName: "Google Chrome",
    siteDomain: "www.instagram.com",
    siteTitle: "Instagram",
    siteUrl,
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

function appSegment(id: string, windowTitle: string): ActivitySegment {
  return {
    id,
    startedAt: "2026-08-14T09:00:00.000Z",
    endedAt: "2026-08-14T09:01:00.000Z",
    durationSeconds: 60,
    appName: id === "notes" ? "Notes" : "Steam",
    bundleId: id === "notes" ? "com.apple.Notes" : "com.valvesoftware.steam",
    windowTitle,
    browserName: null,
    siteDomain: null,
    siteUrl: null,
    platform: "macos",
    source: "nsworkspace",
  };
}
