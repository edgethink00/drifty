// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { LocalizationProvider, type DisplayLanguage } from "../localization/LocalizationContext";
import { translateFor } from "../localization/translate";

const residualCapChart = {
  gridlines: [],
  columns: [
    {
      weekdayIndex: 0,
      weekday: "Mon",
      off: false,
      totalSeconds: 12600,
      barHeightPct: 80,
      segments: [
        { key: "focus", heightPct: 14, color: "var(--flow-tone-focus)", seconds: 1800 },
        { key: "drift", heightPct: 29, color: "var(--flow-tone-drift)", seconds: 3600 },
        { key: "neutral", heightPct: 57, color: "var(--flow-tone-neutral)", seconds: 7200 },
      ],
    },
  ],
};

const emptyChart = {
  gridlines: [],
  columns: [],
};

describe("WeeklyTrendChart", () => {
  it.each([
    ["ja", "月", /30\s*分/u, /1\.5\s*時間/u],
    ["pt-BR", "seg.", /30\s*min/u, /1,5\s*h/u],
    ["zh-Hans", "周一", /30\s*分钟/u, /1\.5\s*小时/u],
    ["fr", "lun.", /30\s*min/u, /1,5\s*h/u],
    ["de", /^Mo\.?$/u, /30\s*Min\./u, /1,5\s*Std\./u],
  ] as const)("localizes visible weekdays and spoken/chart duration units in %s", (language, monday, minutes, hours) => {
    const controller = { effectiveLanguage: language as DisplayLanguage, setDisplayLanguage: vi.fn(), t: translateFor("en") };
    const { container } = render(
      <LocalizationProvider controller={controller}>
        <WeeklyTrendChart chart={{ ...residualCapChart, gridlines: [{ label: "1.5h", topPct: 50 }] }} hasData mode="productivity"
          onHideSegmentHover={vi.fn()} onModeChange={vi.fn()} onMoveSegmentHover={vi.fn()} onShowSegmentHover={vi.fn()} />
      </LocalizationProvider>,
    );
    const weekday = container.querySelector(".wt-daylabel")?.textContent;
    if (typeof monday === "string") expect(weekday).toBe(monday);
    else expect(weekday).toMatch(monday);
    const description = container.querySelector(".wt-seg")?.getAttribute("aria-label");
    expect(description).toContain(`${weekday} · focus ·`);
    expect(description).toMatch(minutes);
    expect(container.querySelector(".wt-gridlabel")?.textContent).toMatch(hours);
  });

  it("exposes the chart mode picker as a labeled single-selection control", () => {
    const onModeChange = vi.fn();

    render(
      <WeeklyTrendChart
        chart={emptyChart}
        hasData={false}
        mode="category"
        projectModeAvailable
        onHideSegmentHover={vi.fn()}
        onModeChange={onModeChange}
        onMoveSegmentHover={vi.fn()}
        onShowSegmentHover={vi.fn()}
      />,
    );

    const modePicker = screen.getByRole("group", { name: "Weekly breakdown mode" });
    const productivity = within(modePicker).getByRole("button", { name: "Productivity" });
    const category = within(modePicker).getByRole("button", { name: "Category" });
    const project = within(modePicker).getByRole("button", { name: "Project" });

    expect(productivity.getAttribute("aria-pressed")).toBe("false");
    expect(category.getAttribute("aria-pressed")).toBe("true");
    expect(project.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(productivity);
    expect(onModeChange).toHaveBeenCalledWith("productivity");
  });

  it("paints residual segments last so column-reverse keeps them as the visual cap", () => {
    render(
      <WeeklyTrendChart
        chart={residualCapChart}
        hasData
        mode="productivity"
        onHideSegmentHover={vi.fn()}
        onModeChange={vi.fn()}
        onMoveSegmentHover={vi.fn()}
        onShowSegmentHover={vi.fn()}
      />,
    );

    const bar = document.querySelector(".wt-bar");
    expect(bar).toBeTruthy();
    expect([...bar!.querySelectorAll(".wt-seg")].map((segment) => (segment as HTMLElement).style.background)).toEqual([
      "var(--flow-tone-focus)",
      "var(--flow-tone-drift)",
      "var(--flow-tone-neutral)",
    ]);
  });
});

describe("weekly detail keyboard and pointer ownership", () => {
  function mount() {
    const show = vi.fn(), hide = vi.fn(), move = vi.fn();
    const view = render(<WeeklyTrendChart chart={residualCapChart} hasData mode="productivity" segmentLabel={(key) => ({focus:"Focus", drift:"Drift", neutral:"Neutral"}[key] ?? key)} onHideSegmentHover={hide} onModeChange={vi.fn()} onMoveSegmentHover={move} onShowSegmentHover={show}/>);
    const cells = [...view.container.querySelectorAll<HTMLDivElement>(".wt-seg")];
    return { ...view, cells, show, hide, move };
  }
  it("uses one Tab stop and arrows/Home/End to open named details", () => {
    const {cells,show,hide} = mount();
    expect(cells.map((cell) => cell.tabIndex)).toEqual([0,-1,-1]);
    expect(cells[0].getAttribute("aria-label")).toBe("Mon · Focus · 30 min · 14%");
    act(() => cells[0].focus());
    expect(show.mock.lastCall?.[0].key).toBe("focus");
    fireEvent.keyDown(cells[0], {key:"ArrowRight"});
    expect(document.activeElement).toBe(cells[1]);
    expect(show.mock.lastCall?.[0].key).toBe("drift");
    expect(cells.map((cell) => cell.tabIndex)).toEqual([-1,0,-1]);
    fireEvent.keyDown(cells[1], {key:"End"});
    expect(document.activeElement).toBe(cells[2]);
    fireEvent.keyDown(cells[2], {key:"Home"});
    expect(document.activeElement).toBe(cells[0]);
    act(() => cells[0].blur());
    expect(hide).toHaveBeenCalled();
  });
  it("keeps focused detail over pointer and restores pointer detail on blur", () => {
    const {cells,show,hide,move} = mount();
    act(() => cells[0].focus());
    fireEvent.mouseEnter(cells[1], {clientX:10,clientY:20});
    expect(show.mock.lastCall?.[0].key).toBe("focus");
    fireEvent.mouseMove(cells[1], {clientX:15,clientY:25});
    expect(move).not.toHaveBeenCalled();
    act(() => cells[0].blur());
    expect(show.mock.lastCall?.[0].key).toBe("drift");
    fireEvent.mouseLeave(cells[1]);
    expect(hide).toHaveBeenCalled();
    act(() => cells[0].focus());
    hide.mockClear();
    fireEvent.mouseEnter(cells[1]);
    fireEvent.mouseLeave(cells[1]);
    expect(hide).not.toHaveBeenCalled();
    expect(show.mock.lastCall?.[0].key).toBe("focus");
  });
});
