import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUDED_APPS,
  REDACTED_APP_NAME,
  buildAppUsageSummaries,
  buildCategoryDurations,
  buildDailyTotals,
  buildRollingFocusSeconds,
  classifyActivityDetailed,
  isExcludedSegment,
  type ActivitySegment,
} from "@drifty/domain";
import { excludedActivityLabel } from "./features/localization/activityTranslations";
import { ENGLISH_TRANSLATIONS, KOREAN_TRANSLATIONS } from "./features/localization/translations";

type ExclusionBoundary = {
  readonly label: string;
  readonly path: string;
  readonly minimumFilterCalls: number;
};

// Canonical inventory of every production path that turns local activity
// segments into public/shared aggregates or sends them to external providers.
// Adding a new publication or cloud analysis surface requires adding it here
// and applying the app-exclusion check.
const EXCLUSION_BOUNDARIES: readonly ExclusionBoundary[] = [
  {
    label: "leaderboard payload builders",
    path: "./features/leaderboard/leaderboardPublisher.ts",
    minimumFilterCalls: 2,
  },
  {
    label: "leaderboard profile metrics",
    path: "./features/leaderboard/useLeaderboardProfileController.ts",
    minimumFilterCalls: 1,
  },
  {
    label: "public focus-card payload builders",
    path: "./features/share/focusCardPublisher.ts",
    minimumFilterCalls: 2,
  },
  {
    label: "daily productivity history series",
    path: "./features/share/dailyProductivity.ts",
    minimumFilterCalls: 1,
  },
  {
    label: "team project totals",
    path: "./features/team/teamProjectTime.ts",
    minimumFilterCalls: 1,
  },
  {
    label: "account summary payload builders",
    path: "./features/account-stats/accountStatsPayload.ts",
    minimumFilterCalls: 2,
  },
  {
    label: "AI classification service",
    path: "./features/classification/aiClassificationService.ts",
    minimumFilterCalls: 2,
  },
] as const;

function makeSampleSegment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "seg-1",
    startedAt: "2026-09-11T10:00:00.000Z",
    endedAt: "2026-09-11T10:30:00.000Z",
    durationSeconds: 1800,
    appName: "Safari",
    windowTitle: "Docs",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

describe("App exclusion privacy boundaries and contracts", () => {
  describe("static boundary checks", () => {
    it.each(EXCLUSION_BOUNDARIES)(
      "$label keeps excluded app time out of shared and analysis surfaces",
      ({ path, minimumFilterCalls }) => {
        const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
        const filterCalls = source.match(/isExcludedSegment\s*\(/g) ?? [];

        expect(source).toMatch(/from\s+["']@drifty\/domain["']/);
        expect(filterCalls.length).toBeGreaterThanOrEqual(minimumFilterCalls);
      },
    );
  });

  describe("domain model helpers and invariants", () => {
    it("recognizes default-seed, user-added, and redacted app name segments as excluded", () => {
      expect(isExcludedSegment({ exclusionSource: "default" })).toBe(true);
      expect(isExcludedSegment({ exclusionSource: "user" })).toBe(true);
      expect(isExcludedSegment({ appName: REDACTED_APP_NAME })).toBe(true);
      expect(isExcludedSegment({ appName: "1Password", exclusionSource: "default" })).toBe(true);
      expect(isExcludedSegment({ appName: "Safari", exclusionSource: null })).toBe(false);
      expect(isExcludedSegment({ appName: "Xcode" })).toBe(false);
    });

    it("seeds the expected 16 default privacy apps", () => {
      expect(DEFAULT_EXCLUDED_APPS.length).toBe(16);
      const appNames = DEFAULT_EXCLUDED_APPS.map((a) => a.name);
      expect(appNames).toContain("1Password");
      expect(appNames).toContain("Keychain Access");
      expect(appNames).toContain("Bitwarden");
      expect(appNames).toContain("Ledger Live");
    });

    it("formats truth-accurate labels based on exclusion source", () => {
      const koreanT = (key: keyof typeof KOREAN_TRANSLATIONS) => KOREAN_TRANSLATIONS[key];
      const englishT = (key: keyof typeof ENGLISH_TRANSLATIONS) => ENGLISH_TRANSLATIONS[key];
      expect(excludedActivityLabel("default", koreanT)).toBe("제외됨 · Drifty 기본");
      expect(excludedActivityLabel("user", koreanT)).toBe("제외됨 · 내 설정");
      expect(excludedActivityLabel(null, koreanT)).toBe("제외됨 · Drifty 기본");
      expect(excludedActivityLabel("default", englishT)).toBe("Excluded · Drifty default");
      expect(excludedActivityLabel("user", englishT)).toBe("Excluded · My settings");
    });

    it("classifies excluded segments strictly as unknown/neutral", () => {
      const normalWorkSegment = makeSampleSegment({
        appName: "Xcode",
        bundleId: "com.apple.dt.xcode",
        windowTitle: "main.swift",
      });
      const classifiedNormal = classifyActivityDetailed(normalWorkSegment);
      expect(classifiedNormal.category).toBe("workspace");
      expect(classifiedNormal.productivity).toBe("focus");

      const excludedWorkSegment = makeSampleSegment({
        appName: REDACTED_APP_NAME,
        exclusionSource: "default",
      });
      const classifiedExcluded = classifyActivityDetailed(excludedWorkSegment);
      expect(classifiedExcluded.category).toBe("unknown");
      expect(classifiedExcluded.productivity).toBe("neutral");
      expect(classifiedExcluded.reason).toContain("excluded");
    });

    it("preserves total tracked time in daily totals while excluding from rolling focus", () => {
      const day = "2026-09-11";
      const focusSegment = makeSampleSegment({
        id: "s1",
        startedAt: "2026-09-11T09:00:00.000Z",
        endedAt: "2026-09-11T10:00:00.000Z",
        durationSeconds: 3600,
        appName: "Xcode",
        bundleId: "com.apple.dt.xcode",
      });
      const excludedSegment = makeSampleSegment({
        id: "s2",
        startedAt: "2026-09-11T10:00:00.000Z",
        endedAt: "2026-09-11T10:30:00.000Z",
        durationSeconds: 1800,
        appName: REDACTED_APP_NAME,
        exclusionSource: "default",
      });

      const segments = [focusSegment, excludedSegment];

      // B안 핵심 불변식: 총 시간은 3600 + 1800 = 5400초 그대로 보존
      const dailyTotals = buildDailyTotals(segments, day, day, 0);
      expect(dailyTotals[0]?.totalSeconds).toBe(5400);

      // 리더보드 / 공유용 포커스 시간 집계에서는 제외 세그먼트가 0초로 제외됨
      const focusSeconds = buildRollingFocusSeconds(segments, day, day);
      expect(focusSeconds).toBe(3600);
    });

    it("excludes redacted segments from app usage summaries and category durations", () => {
      const normalSegment = makeSampleSegment({
        id: "s1",
        appName: "VSCode",
        durationSeconds: 3600,
      });
      const excludedSegment = makeSampleSegment({
        id: "s2",
        appName: REDACTED_APP_NAME,
        exclusionSource: "user",
        durationSeconds: 1800,
      });

      const summaries = buildAppUsageSummaries([normalSegment, excludedSegment]);
      expect(summaries.some((s) => s.appName === REDACTED_APP_NAME)).toBe(false);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.appName).toBe("VSCode");

      const catDurations = buildCategoryDurations([normalSegment, excludedSegment]);
      const totalCatSeconds = catDurations.reduce((sum, d) => sum + d.totalSeconds, 0);
      expect(totalCatSeconds).toBe(3600);
    });
  });
});
