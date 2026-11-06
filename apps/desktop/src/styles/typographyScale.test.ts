import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Typography floor + viewport-linked scale contract.
 *
 * Field feedback (4K 32", 2026-08): app text read as unusually small for a Mac
 * app, and widening the window only grew empty space. Two rules protect the fix:
 *
 * 1. App-internal type never drops below 11px. That is the smallest size defined
 *    by Material 3 (Label Small) and matches Apple's Subheadline; below it the
 *    text stops being a UI label and becomes an unreadable annotation.
 * 2. App type is expressed in rem so the root-level viewport steps scale it.
 *
 * Excluded on purpose:
 * - onboarding owns a separate scoped prototype type system.
 * - companion pill / pet mode are small fixed overlay windows that must keep
 *   their own pixel sizing and must not follow the main window's scale.
 * - companion.css styles the notification surfaces (drift alarm, watcher,
 *   end-of-day review). Those are alert windows, not the dashboard, and this
 *   pass is scoped to the dashboard only.
 */
const SRC_ROOT = resolve(__dirname, "..");
const TYPE_FLOOR_REM = 0.6875;

const EXCLUDED = [
  "features/onboarding/",
  "styles/companion-pill.css",
  "styles/companion.css",
  "features/pet-mode/petMode.css",
];

/** Sizes the owner approved below the floor, each recorded in docs/product-decisions.md. */
const APPROVED_BELOW_FLOOR: readonly { readonly file: string; readonly rem: number }[] = [
  // Week work names sit 4% under the floor to fit more of the name in a block
  // (owner decision 2026-10-16, "Timeline cards (Day/Week)").
  { file: "features/activity-labels/activity-labels.css", rem: 0.66 },
];

function collectCssFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectCssFiles(full, found);
      continue;
    }
    if (entry.endsWith(".css")) found.push(full);
  }
  return found;
}

const cssFiles = collectCssFiles(SRC_ROOT).filter((file) => {
  const rel = relative(SRC_ROOT, file).replace(/\\/g, "/");
  return !EXCLUDED.some((skip) => rel.includes(skip));
});

describe("app typography floor", () => {
  it("scans a meaningful number of stylesheets", () => {
    expect(cssFiles.length).toBeGreaterThan(20);
  });

  it("keeps every app-internal rem font-size at or above the 11px floor", () => {
    const violations: string[] = [];

    for (const file of cssFiles) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        const matches = line.matchAll(/font-size:\s*(\.?[0-9.]+)rem/g);
        for (const match of matches) {
          const value = Number.parseFloat(match[1]);
          const rel = relative(SRC_ROOT, file).replace(/\\/g, "/");
          const approved = APPROVED_BELOW_FLOOR.some((entry) => entry.file === rel && entry.rem === value);
          if (Number.isFinite(value) && value < TYPE_FLOOR_REM && !approved) {
            violations.push(`${rel}:${index + 1} -> ${value}rem`);
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("keeps app-internal type in rem so the viewport scale reaches it", () => {
    const violations: string[] = [];

    for (const file of cssFiles) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        const match = line.match(/font-size:\s*([0-9.]+)px/);
        if (!match) return;
        violations.push(`${relative(SRC_ROOT, file)}:${index + 1} -> ${match[1]}px`);
      });
    }

    expect(violations).toEqual([]);
  });
});

describe("viewport-linked type scale", () => {
  const tokens = readFileSync(join(SRC_ROOT, "styles/tokens-base.css"), "utf8");

  it("defines a base root font size", () => {
    expect(tokens).toMatch(/html\s*{[^}]*font-size:\s*100%/);
  });

  it("steps the root size up at wider viewports", () => {
    for (const breakpoint of ["1600px", "2000px", "2400px"]) {
      expect(tokens).toContain(`@media (min-width: ${breakpoint})`);
    }
  });

  it("scales only the main window, never auxiliary overlay surfaces", () => {
    const scaleRules = tokens.match(/@media \(min-width: [0-9]+px\)\s*{\s*([^}]*)}/g) ?? [];
    expect(scaleRules.length).toBeGreaterThanOrEqual(3);
    for (const rule of scaleRules) {
      expect(rule).toContain("html:not([data-surface])");
    }
  });
});

describe("type scale migration", () => {
  // Day, Week and Insights moved onto the shared --text-* scale first (2026-11-06);
  // Classification, Projects, History, Leaderboard and Teams followed the same day,
  // then the shared layers (prototype-compat, shared surfaces, app shell, modal
  // chrome) and the remaining content features (profile, social, read, day note).
  // Settings, onboarding, Companion, pet and share-card sizes keep their own reviews.
  // A literal size there would start a new off-scale value again. Display numerals
  // above the 32px top step (the 36px category total, the 40px rank) stay literal.
  const MIGRATED = [
    "features/dashboard/dashboard.css",
    "features/dashboard/week-dashboard.css",
    "styles/week-dashboard.css",
    "styles/dashboard-today.css",
    "features/flow-chart/flow-chart.css",
    "features/insights/insights.css",
    "features/dashboard/month-calendar.css",
    "styles/classification.css",
    "features/projects/projects.css",
    "features/projects/project-detail.css",
    "features/projects/project-trend-chart.css",
    "features/history/history.css",
    "features/leaderboard/leaderboard-screen.css",
    "features/leaderboard/leaderboard.css",
    "features/leaderboard/rank-embeds.css",
    "styles/leaderboard.css",
    "features/team/team.css",
    "features/team/TeamInviteDialog.css",
    // The Memory tab (beta) joined the scale with its flow and page review (2026-11-06).
    "features/memory/work-memory-page.css",
    "features/settings/memory-settings.css",
    "styles/prototype-compat.css",
    "styles/shared-surfaces.css",
    "features/profile/profile-page.css",
    "features/social/social.css",
    "features/categories/categoryEditor.css",
    "styles/modal-chrome.css",
    "styles/app-shell.css",
    "features/classification/styles/classification-breakdown-usage.css",
    "features/classification/project-corrections.css",
    "features/dashboard/compact-charts.css",
    "features/dashboard/activity-inspection.css",
    "features/dashboard/your-day-rows.css",
    "features/insights/read/readPage.css",
    "features/insights/read/readWait.css",
    "features/day-note/dayNote.css",
    "styles/visual-parity.css",
    "features/whats-new/WhatsNewDialog.css",
    "features/activity-labels/activity-labels.css",
    "features/sidebar/SidebarCtaSlot.css",
  ];

  it("keeps the migrated surfaces on the scale tokens", () => {
    const literals = MIGRATED.flatMap((rel) =>
      [...readFileSync(join(SRC_ROOT, rel), "utf8").matchAll(/font-size:\s*([0-9.]+)(rem|px)/g)]
        .filter((m) => Number(m[1]) * (m[2] === "rem" ? 16 : 1) <= 34)
        // Week calendar block names fit 12-28px blocks; their line box sets the
        // icon inset the Week calendar layout test pins.
        .filter((m) => !(rel === "features/activity-labels/activity-labels.css" && m[0] === "font-size: 0.66rem"))
        .map((m) => rel + " -> " + m[1] + m[2]),
    );
    expect(literals).toEqual([]);
  });

  it("defines every scale step", () => {
    const tokens = readFileSync(join(SRC_ROOT, "styles/tokens-base.css"), "utf8");
    for (const [name, value] of [["2xs", "0.6875rem"], ["xs", "0.75rem"], ["sm", "0.8125rem"], ["md", "0.875rem"], ["lg", "0.9375rem"], ["xl", "1.0625rem"], ["2xl", "1.25rem"], ["3xl", "1.5rem"], ["4xl", "1.75rem"], ["5xl", "2rem"]]) {
      expect(tokens).toContain("--text-" + name + ": " + value + ";");
    }
  });
});
