// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChartHeadControls, TimelineZoomControl } from "./TimelineZoomControl";
import { nearestTimelineZoomStep, timelineZoomStorageKey, useTimelineZoomPreference } from "./timelineZoom";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

function DashboardZoom({ view = "day" }: { view?: "day" | "week" }) {
  const zoom = useTimelineZoomPreference(view);
  return <LocalizationTestProvider language="ko"><TimelineZoomControl {...zoom} /></LocalizationTestProvider>;
}
const menu = () => screen.getByRole("combobox", { name: "시간 확대" });
const choose = (label: string) => {
  fireEvent.click(menu());
  fireEvent.click(screen.getByRole("option", { name: label }));
};
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("offers seven steps, numbers only, in the app's own menu, not a system menu", () => {
  render(<DashboardZoom />);
  expect(document.querySelector(".timeline-zoom select")).toBeNull();
  fireEvent.click(menu());
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["100%", "125%", "150%", "175%", "200%", "250%", "300%"]);
  expect(menu().textContent).toBe("150%");
});

it("remembers independent Day and Week choices and can return to 150%", () => {
  const day = render(<DashboardZoom />);
  choose("300%");
  expect(localStorage.getItem(timelineZoomStorageKey("day"))).toBe("300");
  day.unmount();
  const week = render(<DashboardZoom view="week" />);
  expect(menu().textContent).toContain("150%");
  week.unmount();
  render(<DashboardZoom />);
  expect(menu().textContent).toContain("300%");
  choose("150%");
  expect(localStorage.getItem(timelineZoomStorageKey("day"))).toBe("150");
});

it("shows a zoom saved by an earlier build at its nearest step and follows other windows the same way", () => {
  localStorage.setItem(timelineZoomStorageKey("day"), "160");
  render(<DashboardZoom />);
  expect(menu().textContent).toContain("150%");
  fireEvent(window, new StorageEvent("storage", { key: timelineZoomStorageKey("day"), newValue: "240" }));
  expect(menu().textContent).toContain("250%");
  fireEvent(window, new StorageEvent("storage", { key: timelineZoomStorageKey("day"), newValue: "310" }));
  expect(menu().textContent).toContain("250%");
  expect([100, 160, 225, 230, 290].map(nearestTimelineZoomStep)).toEqual([100, 150, 200, 250, 300]);
  expect([99, 301, Number.NaN, Number.POSITIVE_INFINITY].map(nearestTimelineZoomStep)).toEqual([null, null, null, null]);
});

it("ignores corrupt preferences", () => {
  localStorage.setItem(timelineZoomStorageKey("day"), "Infinity");
  render(<DashboardZoom />);
  expect(menu().textContent).toContain("150%");
});

it("keeps changing the current view when preferences cannot be saved", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  render(<DashboardZoom />);
  choose("200%");
  expect(menu().textContent).toContain("200%");
});

it("puts the zoom after the colour switch, at the right edge, in reading and keyboard order", () => {
  const { container } = render(<LocalizationTestProvider language="ko">
    <ChartHeadControls timeZoom={{ percent: 150, onChange: () => {} }}><div className="seg" data-part="color" /></ChartHeadControls>
  </LocalizationTestProvider>);
  const controls = container.querySelector(".flow-chart-head__controls");
  expect([...(controls?.children ?? [])].map((child) => child.classList.contains("timeline-zoom") ? "zoom" : "color")).toEqual(["color", "zoom"]);
});

it("draws only the colour switch when there is no time zoom", () => {
  const { container } = render(<ChartHeadControls><div className="seg" /></ChartHeadControls>);
  expect(container.querySelector(".flow-chart-head__controls")?.children).toHaveLength(1);
});
