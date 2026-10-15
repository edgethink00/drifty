// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeeklyCategoryRow } from "./InsightCards";
import { buildWeeklyBreakdown, NO_PROJECT_KEY, type WeeklyChartMode } from "./insightData";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

const rawSegment: ActivitySegment = {
  id: "raw-segment",
  startedAt: "2026-08-17T09:00:00+09:00",
  endedAt: "2026-08-17T09:03:00+09:00",
  durationSeconds: 180,
  appName: "Visual Studio Code",
  bundleId: "com.microsoft.VSCode",
  platform: "macos",
  source: "nsworkspace",
  classification: {
    category: "workspace",
    productivity: "focus",
    source: "manual",
    confidence: 1,
  },
};

const projectedSegment: ActivitySegment = {
  ...rawSegment,
  id: "project-window:personal:2026-08-17T00:00:00.000Z:raw-segment",
};

afterEach(() => {
  cleanup();
});

function projectRow(projectModeAvailable: boolean, onModeChange = vi.fn(), mode: WeeklyChartMode = "project") {
  return (
    <WeeklyCategoryRow
      appIcons={{}}
      categoryTotals={[{ category: "workspace", totalSeconds: 180, segments: 1, ratio: 1 }]}
      classificationOptions={{}}
      mode={mode}
      onModeChange={onModeChange}
      productivityDurations={[{ productivity: "focus", totalSeconds: 180, segments: 1, ratio: 1 }]}
      productivityTotals={{ focus: 180, neutral: 0, drift: 0 }}
      projectBySegmentId={new Map([[projectedSegment.id, "project-drifty"]])}
      projectMeta={new Map([["project-drifty", { label: "Drifty", color: "#6366f1" }]])}
      projectModeAvailable={projectModeAvailable}
      projectSegments={[projectedSegment]}
      projectSeries={[{ key: "project-drifty", color: "#6366f1" }]}
      segments={[rawSegment]}
      weekly={[{
        weekdayIndex: 0,
        weekday: "Mon",
        isActive: true,
        focusSeconds: 180,
        neutralSeconds: 0,
        driftSeconds: 0,
        categorySeconds: { workspace: 180 },
        projectSeconds: { "project-drifty": 180 },
      }]}
    />
  );
}

describe("WeeklyCategoryRow project mode", () => {
  it.each(["en", "ko"] as const)("shows projected project totals and unassigned time in the %s rail", (language) => {
    const assigned = { ...projectedSegment, durationSeconds: 60 };
    const unassigned = { ...projectedSegment, id: "unassigned-slice", durationSeconds: 120 };
    const unknown: ActivitySegment = {
      ...rawSegment,
      id: "unknown-slice",
      durationSeconds: 900,
      classification: { category: "unknown", productivity: "neutral", source: "manual", confidence: 1 },
    };
    const projectSegments = [assigned, unassigned, unknown];
    const projectBySegmentId = new Map([[assigned.id, "project-drifty"]]);
    render(
      <LocalizationTestProvider language={language}>
        <WeeklyCategoryRow
          appIcons={{}}
          categoryTotals={[{ category: "workspace", totalSeconds: 180, segments: 1, ratio: 1 }]}
          classificationOptions={{}}
          mode="project"
          onModeChange={vi.fn()}
          productivityDurations={[{ productivity: "focus", totalSeconds: 180, segments: 1, ratio: 1 }]}
          productivityTotals={{ focus: 180, neutral: 0, drift: 0 }}
          projectBySegmentId={projectBySegmentId}
          projectMeta={new Map([["project-drifty", { label: "Drifty", color: "#6366f1" }]])}
          projectModeAvailable
          projectSegments={projectSegments}
          projectSeries={[{ key: "project-drifty", color: "#6366f1" }, { key: NO_PROJECT_KEY, color: "#9ca3af" }]}
          segments={[rawSegment, unknown]}
          weekly={buildWeeklyBreakdown([rawSegment, unknown], {}, undefined, projectBySegmentId, projectSegments)}
        />
      </LocalizationTestProvider>,
    );

    const rail = screen.getByLabelText(language === "ko" ? "프로젝트 분석" : "Insight project breakdown");
    const labels = [...rail.querySelectorAll(".flow-compact-split-chart__legend-label")].map((node) => node.textContent);
    expect(labels).toEqual(["Drifty", language === "ko" ? "프로젝트 없음" : "No project"]);
    expect(rail.querySelector(".flow-compact-split-chart__head strong")?.textContent).toBe(language === "ko" ? "3분" : "3m");
    const barSegments = [...rail.querySelectorAll<HTMLElement>(".flow-compact-split-chart__segment")];
    expect(barSegments.map((node) => node.title)).toEqual([
      language === "ko" ? "Drifty · 1분 · 33%" : "Drifty · 1m · 33%",
      language === "ko" ? "프로젝트 없음 · 2분 · 67%" : "No project · 2m · 67%",
    ]);
    expect(barSegments.map((node) => node.style.background)).toEqual(["rgb(99, 102, 241)", "rgb(156, 163, 175)"]);
    expect(screen.queryByLabelText(/^(Insight category breakdown|카테고리 분석)$/)).toBeNull();

    fireEvent.mouseEnter(barSegments[0], { clientX: 160, clientY: 160 });
    const hover = document.body.querySelector<HTMLElement>(".category-hover-card")!;
    expect(within(hover).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(hover).getByText(language === "ko" ? "기록 시간의 33%" : "33% of tracked time")).toBeTruthy();
  });

  it("switches the lower rail back to categories while preserving the period productivity summary", () => {
    const { rerender } = render(projectRow(true));
    const summary = screen.getByLabelText("Insight productivity breakdown");
    const originalSummary = summary.textContent;
    expect(within(summary).getByText("Overall productivity")).toBeTruthy();
    const projectRail = screen.getByLabelText("Insight project breakdown");
    fireEvent.mouseEnter(projectRail.querySelector(".flow-compact-split-chart__segment")!, { clientX: 160, clientY: 160 });
    expect(document.body.querySelector(".category-hover-card")).toBeTruthy();

    for (const mode of ["category", "productivity"] as const) {
      rerender(projectRow(true, vi.fn(), mode));
      expect(screen.queryByLabelText("Insight project breakdown")).toBeNull();
      expect(screen.getByLabelText("Insight category breakdown").textContent).toContain("Workspace");
      expect(screen.getByLabelText("Insight productivity breakdown").textContent).toBe(originalSummary);
      expect(document.body.querySelector(".category-hover-card")).toBeNull();
    }
    rerender(projectRow(true));
    expect(screen.getByLabelText("Insight project breakdown").textContent).toContain("Drifty");
    expect(screen.getByLabelText("Insight productivity breakdown").textContent).toBe(originalSummary);
  });

  it("builds hover details from projected project slices instead of raw segment ids", () => {
    render(projectRow(true));

    const weeklyTrend = screen.getByLabelText(/weekly focus and drift trend/i);
    expect(within(weeklyTrend).getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");

    const projectSegment = weeklyTrend.querySelector<HTMLElement>(".wt-seg");
    expect(projectSegment).toBeTruthy();
    fireEvent.mouseEnter(projectSegment!, { clientX: 160, clientY: 160 });

    const hoverCard = document.body.querySelector<HTMLElement>(".category-hover-card");
    expect(hoverCard).toBeTruthy();
    expect(within(hoverCard!).getByText(/^Drifty$/)).toBeTruthy();
    expect(within(hoverCard!).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(hoverCard!).getAllByText("3m").length).toBeGreaterThan(0);
  });

  it("derives a Category fallback without changing the controlled Project request", () => {
    const onModeChange = vi.fn();
    const { rerender } = render(projectRow(false, onModeChange));

    let modePicker = screen.getByRole("group", { name: "Weekly breakdown mode" });
    expect(within(modePicker).getByRole("button", { name: "Category" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(modePicker).queryByRole("button", { name: "Project" })).toBeNull();
    expect(screen.queryByLabelText("Insight project breakdown")).toBeNull();
    expect(screen.getByLabelText("Insight category breakdown")).toBeTruthy();
    expect(onModeChange).not.toHaveBeenCalled();

    rerender(projectRow(true, onModeChange));

    modePicker = screen.getByRole("group", { name: "Weekly breakdown mode" });
    expect(within(modePicker).getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");
    expect(onModeChange).not.toHaveBeenCalled();
  });
});

describe("WeeklyCategoryRow classified categories", () => {
  it("keeps unclassified out of the Insights category labels and bar", () => {
    render(
      <WeeklyCategoryRow
        appIcons={{}}
        categoryTotals={[
          { category: "unknown", totalSeconds: 4400, segments: 4, ratio: 0.44 },
          { category: "workspace", totalSeconds: 3600, segments: 2, ratio: 0.36 },
          { category: "entertainment", totalSeconds: 2000, segments: 1, ratio: 0.2 },
        ]}
        classificationOptions={{}}
        mode="category"
        onModeChange={vi.fn()}
        productivityDurations={[{ productivity: "focus", totalSeconds: 3600, segments: 2, ratio: 0.64 }]}
        productivityTotals={{ focus: 3600, neutral: 0, drift: 2000 }}
        projectSegments={[]}
        segments={[rawSegment]}
        weekly={[{
          weekdayIndex: 0,
          weekday: "Mon",
          isActive: true,
          focusSeconds: 3600,
          neutralSeconds: 0,
          driftSeconds: 2000,
          categorySeconds: { workspace: 3600, entertainment: 2000, unknown: 4400 },
          projectSeconds: {},
        }]}
      />,
    );

    const categoryBreakdown = screen.getByRole("generic", { name: /^insight category breakdown$/i });
    const labels = Array.from(categoryBreakdown.querySelectorAll(".flow-compact-split-chart__legend-label")).map((node) => node.textContent);
    expect(labels).toEqual(["Workspace", "Entertainment"]);
    expect(labels).not.toContain("Unclassified");
    expect(categoryBreakdown.textContent).not.toMatch(/Unclassified|미분류/);
    expect(Array.from(categoryBreakdown.querySelectorAll(".flow-compact-split-chart__segment")).map((node) => node.getAttribute("title") ?? "").join("\n")).not.toMatch(/Unclassified|미분류/);
  });
});
