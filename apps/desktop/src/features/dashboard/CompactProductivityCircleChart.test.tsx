// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import type { AppIconMap, ProductivityDuration } from "@drifty/domain";
import { CompactProductivityCircleChart } from "./CompactProductivityCircleChart";

describe("CompactProductivityCircleChart", () => {
  it("uses decimal hours only in the productivity legend", () => {
    const totalSeconds = (7 * 3600) + (34 * 60);
    const entries = [
      {
        productivity: "focus",
        totalSeconds: (5 * 3600) + (33 * 60),
        segments: 4,
        ratio: ((5 * 3600) + (33 * 60)) / totalSeconds,
      },
      {
        productivity: "drift",
        totalSeconds: (1 * 3600) + (15 * 60),
        segments: 2,
        ratio: ((1 * 3600) + (15 * 60)) / totalSeconds,
      },
      {
        productivity: "neutral",
        totalSeconds: 46 * 60,
        segments: 1,
        ratio: (46 * 60) / totalSeconds,
      },
    ] satisfies ProductivityDuration[];
    const appIcons: AppIconMap = {};

    const { container } = render(
      <CompactProductivityCircleChart
        entries={entries}
        totalSeconds={totalSeconds}
        flowBlocks={[]}
        appIcons={appIcons}
      />,
    );

    const panel = container.querySelector(".flow-compact-split-chart__panel--circle");
    if (!(panel instanceof HTMLElement)) throw new Error("Productivity circle panel did not render");

    const headerValue = panel.querySelector(".flow-compact-split-chart__head strong");
    if (!(headerValue instanceof HTMLElement)) throw new Error("Productivity circle header value did not render");

    const legend = panel.querySelector(".flow-compact-split-chart__legend");
    if (!(legend instanceof HTMLElement)) throw new Error("Productivity circle legend did not render");

    expect(headerValue.textContent).toBe("7h 34m");
    expect(within(legend).getByText("5.5h")).toBeTruthy();
    expect(within(legend).getByText("1.2h")).toBeTruthy();
    expect(within(legend).getByText("0.7h")).toBeTruthy();
    expect(within(legend).queryByText("5h 33m")).toBeNull();
  });

  it("excludes unclassified time from the focus percent without rendering a note", () => {
    const totalSeconds = 4 * 3600;
    const entries = [
      { productivity: "focus", totalSeconds: 3600, segments: 2, ratio: 3600 / totalSeconds },
      { productivity: "neutral", totalSeconds: 0, segments: 0, ratio: 0 },
      { productivity: "drift", totalSeconds: 3600, segments: 1, ratio: 3600 / totalSeconds },
    ] satisfies ProductivityDuration[];

    const { container } = render(
      <CompactProductivityCircleChart
        entries={entries}
        totalSeconds={totalSeconds}
        flowBlocks={[]}
        appIcons={{}}
      />,
    );

    const center = container.querySelector(".flow-compact-productivity-circle__center strong");
    // 1h focus of 2h classified = 50%, not 25% of the 4h tracked total.
    expect(center?.textContent).toBe("50%");
    // The unclassified remainder is no longer surfaced as a note.
    expect(container.querySelector(".flow-compact-productivity-circle__note")).toBeNull();
  });
});
