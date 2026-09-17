import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("date-nav jump label", () => {
  it("keeps the dashboard and classification jump control on one period-agnostic label", () => {
    const app = readFileSync(join(sourceRoot, "App.tsx"), "utf8");
    const classification = readFileSync(join(sourceRoot, "features/classification/ClassificationPage.tsx"), "utf8");

    expect(app).toContain('todayLabel={localization.t("common.now")}');
    expect(app).not.toMatch(/todayLabel=\{dashPeriod === "Today" \? localization\.t\("dashboard\.today\.today"\)/);
    expect(classification).toContain('todayLabel={t("common.now")}');
    expect(classification).not.toContain('todayLabel={t("classification.today")}');
    expect(classification).toContain('{t("classification.today")}');
  });

  it("keeps the day-nav cluster on a 2px gap in both layout sheets", () => {
    const shell = readFileSync(join(sourceRoot, "styles/app-shell.css"), "utf8");
    const prototype = readFileSync(join(sourceRoot, "styles/prototype-compat.css"), "utf8");

    expect(shell).toMatch(/\.day-nav \{[\s\S]*?gap:\s*2px;/);
    expect(prototype).toMatch(/\.day-nav \{[\s\S]*?gap:\s*2px;/);
  });

  it("keeps the dashboard date caption on one column width across day and week", () => {
    const dashboard = readFileSync(join(sourceRoot, "features/dashboard/dashboard.css"), "utf8");
    expect(dashboard).toMatch(/\.dashboard-page-head--today \.day-nav__current \{[\s\S]*?min-width:\s*6rem;/);
    expect(dashboard).toMatch(/\.dashboard-page-head--today \.day-nav__current \{[\s\S]*?text-align:\s*end;/);
    expect(dashboard).toMatch(/\.dashboard-page-head--today \.day-nav__current \{[\s\S]*?align-items:\s*end;/);
  });
});
