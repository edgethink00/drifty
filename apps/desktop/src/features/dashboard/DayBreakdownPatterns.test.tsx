// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";
import { DayBreakdownPatterns } from "./DayBreakdownPatterns";
import { buildDayPatternMetrics, EMPTY_DAY_PATTERN_METRICS } from "./dayPatternMetrics";

const DAY = "2026-10-13";

function segment(
  id: string,
  start: string,
  minutes: number,
  productivity: "focus" | "drift" | null,
  appName = "Cursor",
  siteDomain?: string,
): ActivitySegment {
  const startedAt = new Date(`${DAY}T${start}:00`);
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    appName,
    bundleId: `com.example.${appName.toLowerCase().replace(/\s+/gu, "-")}`,
    windowTitle: "Untitled",
    siteDomain,
    platform: "macos",
    source: "manual",
    classification: productivity === null ? null : {
      category: productivity === "drift" ? "entertainment" : "workspace",
      productivity,
      source: "manual",
      confidence: 1,
    },
  };
}

const TYPICAL_DAY = [
  segment("morning", "09:05", 15, "focus"),
  segment("noon", "11:30", 12, "focus"),
  segment("afternoon", "14:10", 32, "focus"),
  segment("feed", "21:40", 100, "drift", "Safari", "youtube.com"),
  segment("late", "23:30", 20, "focus", "Notion"),
];

function renderPatterns(segments: ActivitySegment[], language: DisplayLanguage = "en") {
  return render(
    <LocalizationTestProvider language={language}>
      <DayBreakdownPatterns metrics={buildDayPatternMetrics(segments)} />
    </LocalizationTestProvider>,
  );
}

function tile(container: HTMLElement, name: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`.insight-summary__tile--${name}`);
  if (!found) throw new Error(`${name} tile did not render`);
  return found;
}

describe("DayBreakdownPatterns", () => {
  it("draws every focus run with height for its length and marks the longest", () => {
    const { container } = renderPatterns(TYPICAL_DAY);
    const section = screen.getByLabelText("Longest streak");
    const bars = Array.from(section.querySelectorAll<HTMLElement>(".day-streak__bar"));

    expect(within(section).getByText("32m")).toBeTruthy();
    expect(bars).toHaveLength(4);
    expect(bars.map((bar) => bar.style.height)).toEqual(["9px", "8px", "14px", "10px"]);
    expect(bars.filter((bar) => bar.classList.contains("day-streak__bar--longest"))).toEqual([bars[2]]);
    // 9 AM to midnight: the 2:10 PM run starts a third of the way along.
    expect(bars[2].style.left).toBe(`${(310 / 900) * 100}%`);
    expect(screen.getByRole("img", { name: "Focus streaks from 9 AM to 12 AM: 4. Longest: 2:10 – 2:42 PM" })).toBeTruthy();
    const labels = container.querySelector<HTMLElement>(".day-streak__labels");
    expect(labels?.textContent).toBe("9 AM2:10 – 2:42 PM12 AM");
  });

  it("fills the pattern tiles from the day's focus and drift", () => {
    const { container } = renderPatterns(TYPICAL_DAY);

    expect(within(tile(container, "top-focus")).getByText("Cursor").getAttribute("title")).toBe("Cursor");
    expect(within(tile(container, "top-focus")).getByText("59m")).toBeTruthy();
    expect(within(tile(container, "top-drift")).getByText("youtube.com")).toBeTruthy();
    expect(within(tile(container, "top-drift")).getByText("1h 40m")).toBeTruthy();
    expect(within(tile(container, "longest-drift")).getByText("1h 40m")).toBeTruthy();
    expect(within(tile(container, "longest-drift")).getByText("from 9:40 PM")).toBeTruthy();
    // Cursor → youtube.com → Notion is two switches in 2h 59m of tracking.
    expect(within(tile(container, "switches")).getByText("1 / h")).toBeTruthy();
  });

  it("speaks Korean with the dashboard's 24-hour axis hours", () => {
    const { container } = renderPatterns(TYPICAL_DAY, "ko");
    const section = screen.getByLabelText("최장 집중");

    expect(within(section).getByText("32분")).toBeTruthy();
    expect(container.querySelector(".day-streak__labels")?.textContent).toBe("9시오후 2:10 – 2:420시");
    expect(within(tile(container, "switches")).getByText("시간당 1회")).toBeTruthy();
    expect(within(tile(container, "longest-drift")).getByText(/오후 9:40부터/u)).toBeTruthy();
  });

  it("says the streak waits for classification on an unclassified day", () => {
    const { container } = renderPatterns([segment("pending", "09:00", 30, null, "Unlabeled Tool")]);
    const section = screen.getByLabelText("Longest streak");

    expect(within(section).getByText("\u2014")).toBeTruthy();
    expect(within(section).getByText("Shows once activity is classified")).toBeTruthy();
    expect(section.querySelector(".day-streak__chart")).toBeNull();
    expect(within(tile(container, "top-focus")).getByText("Not classified")).toBeTruthy();
    expect(within(tile(container, "top-drift")).getByText("Not classified")).toBeTruthy();
  });

  it("tells a classified day without focus apart from one awaiting classification", () => {
    const { container } = renderPatterns([
      segment("feed", "20:00", 45, "drift", "Safari", "youtube.com"),
      segment("chat", "21:00", 120, "drift", "Discord"),
    ]);
    const section = screen.getByLabelText("Longest streak");

    expect(within(section).getByText("No focus streak yet")).toBeTruthy();
    expect(within(tile(container, "top-focus")).getByText("No focus")).toBeTruthy();
    expect(within(tile(container, "top-drift")).getByText("Discord")).toBeTruthy();
    // One switch in 2h 45m is not zero switches.
    expect(within(tile(container, "switches")).getByText("<1 / h")).toBeTruthy();
    expect(within(tile(container, "switches")).getByText("1h 23m avg")).toBeTruthy();
  });

  it("keeps an empty measurement quiet", () => {
    const { container } = render(
      <LocalizationTestProvider language="en">
        <DayBreakdownPatterns metrics={EMPTY_DAY_PATTERN_METRICS} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("No focus streak yet")).toBeTruthy();
    expect(within(tile(container, "switches")).getByText("\u2014")).toBeTruthy();
  });
});
