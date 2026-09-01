// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsDaySource } from "./agentsPageModel";
import { useAgentsData } from "./useAgentsData";
import { AgentsPage } from "./AgentsPage";

vi.mock("./useAgentsData", () => ({
  useAgentsData: vi.fn(),
}));

vi.mock("./useAgentsIntensityScale", async () => {
  const actual = await vi.importActual<typeof import("./useAgentsIntensityScale")>("./useAgentsIntensityScale");
  return {
    ...actual,
    useAgentsIntensityScale: ({ visiblePeak }: { visiblePeak: number }) => ({
      peak: visiblePeak,
      bands: actual.agentsIntensityBandsForScale({ peak: visiblePeak, lockedOnDay: "2026-08-28" }, visiblePeak),
    }),
  };
});

const source: AgentsDaySource = {
  day: "2026-08-28",
  attention: [[60, 90]],
  turns: [[60, 120, "codex", "drifty_mac", "gpt-5", 1_000]],
  commits: [[110, 12, 3, 2, "abc123", "drifty_mac"]],
  sessions: 1,
  tokens: 1_000,
};

function renderAgentsPage(overrides: Partial<Parameters<typeof AgentsPage>[0]> = {}) {
  const props: Parameters<typeof AgentsPage>[0] = {
    flowIntervalMinutes: 3,
    onFlowIntervalChange: vi.fn(),
    onSelectDay: vi.fn(),
    selectedDay: "2026-08-28",
    startOfDayMinutes: 0,
    startOfWeek: "monday",
    todayDay: "2026-08-28",
    ...overrides,
  };
  render(<AgentsPage {...props} />);
  return props;
}

describe("AgentsPage shared dashboard controls", () => {
  beforeEach(() => {
    vi.mocked(useAgentsData).mockReturnValue({ days: [source], loading: false, live: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("navigates Day and Week ranges with the shared date navigator", () => {
    const props = renderAgentsPage();

    expect(screen.getByRole("button", { name: "Show previous agents day" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show next agents day" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Today" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show previous agents day" }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-08-27");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Show previous agents week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "This Week" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Aug 24–30")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show previous agents week" }));
    expect(props.onSelectDay).toHaveBeenCalledWith("2026-08-21");
  });

  it("uses the same persisted Flow detail control as Your Day", () => {
    const onFlowIntervalChange = vi.fn();
    renderAgentsPage({ flowIntervalMinutes: 3, onFlowIntervalChange });

    expect(screen.queryByRole("button", { name: "3m" })).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Flow detail: 3m" }));
    fireEvent.click(screen.getByRole("option", { name: "6m" }));

    expect(onFlowIntervalChange).toHaveBeenCalledWith(6);
  });

  it("does not label the initial loading state as sample data", () => {
    vi.mocked(useAgentsData).mockReturnValue({
      days: [{ day: source.day, attention: [], turns: [], commits: [] }],
      loading: true,
      live: false,
    });

    renderAgentsPage();

    const heading = screen.getByRole("heading", { name: "Loading agent activity" });
    expect(heading).toBeTruthy();
    expect(heading.textContent).toBe("Agents ran");
    expect(heading.querySelector(".loading-skeleton-line--metric")).toBeTruthy();
    expect(screen.queryByText("Loading agent activity")).toBeNull();
    expect(screen.queryByText(/sample/i)).toBeNull();
    expect(document.querySelector(".page--agents")?.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps Agents ran visible when the requested day is still loading", () => {
    const { rerender } = render(
      <AgentsPage
        flowIntervalMinutes={3}
        onFlowIntervalChange={vi.fn()}
        onSelectDay={vi.fn()}
        selectedDay="2026-08-28"
        startOfDayMinutes={0}
        startOfWeek="monday"
        todayDay="2026-08-28"
      />,
    );

    expect(screen.getByRole("heading", { name: "Agents ran for 1.0h" }).textContent).toBe("Agents ran1.0h");

    vi.mocked(useAgentsData).mockReturnValue({
      days: [{ day: "2026-08-27", attention: [], turns: [], commits: [] }],
      loading: true,
      live: false,
    });
    rerender(
      <AgentsPage
        flowIntervalMinutes={3}
        onFlowIntervalChange={vi.fn()}
        onSelectDay={vi.fn()}
        selectedDay="2026-08-27"
        startOfDayMinutes={0}
        startOfWeek="monday"
        todayDay="2026-08-28"
      />,
    );

    const loadingHeading = screen.getByRole("heading", { name: "Loading agent activity" });
    expect(loadingHeading.textContent).toBe("Agents ran");
    expect(loadingHeading.querySelector(".loading-skeleton-line--metric")).toBeTruthy();
    expect(screen.queryByText("Loading agent activity")).toBeNull();
  });

  it("keeps sub-minute agent time out of the headline", () => {
    vi.mocked(useAgentsData).mockReturnValue({
      days: [{
        ...source,
        attention: [],
        turns: [[60, 60.4, "codex", "drifty_mac"]],
        commits: [],
      }],
      loading: false,
      live: true,
    });

    renderAgentsPage();

    const heading = screen.getByRole("heading", { name: "No agent activity" });
    expect(heading).toBeTruthy();
    expect(heading.textContent).toBe("No agent activity");
    expect(heading.querySelector(".dashboard-page-head__focus-value")).toBeNull();
  });

  it("shows shared hover details for Day cells and Week runs", () => {
    renderAgentsPage();

    const dayCell = screen.getAllByRole("button", { name: /drifty_mac/i })[0];
    fireEvent(dayCell, new MouseEvent("pointermove", { bubbles: true, clientX: 80, clientY: 80 }));
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("drifty_mac");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    const weekRun = screen.getByLabelText(/Agent run on Fri, 2026-08-28, drifty_mac, Codex/i);
    fireEvent(weekRun, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("drifty_mac");
    expect(document.querySelector(".flow-hover-card")?.textContent).not.toContain("Not classified yet");
    expect(weekRun.getAttribute("aria-label")).toContain("approximately 1.0h at 5-minute resolution");

    fireEvent.focus(weekRun);
    fireEvent.blur(weekRun);
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("drifty_mac");

    const calendarBody = document.querySelector(".week-v2-calendar__body");
    if (!calendarBody) throw new Error("Expected the week calendar body");
    fireEvent.pointerLeave(calendarBody);
    expect(document.querySelector(".flow-hover-card")).toBeNull();
    fireEvent.focus(weekRun);
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("drifty_mac");
    fireEvent.pointerLeave(calendarBody);
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("drifty_mac");
    expect(document.querySelectorAll('.agents-week-calendar__event[tabindex="0"]')).toHaveLength(1);
  });

  it("uses the Your Week calendar-only main surface and keeps commits out of the left column", () => {
    renderAgentsPage();

    expect(document.querySelector(".agents-rhythm-chart")).toBeTruthy();
    expect(document.querySelector(".app-usage-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const weekPage = document.querySelector(".page--agents.page--week-dashboard");
    const calendar = weekPage?.querySelector(".agents-week-calendar");
    expect(calendar?.querySelector(".pg-head")).toBeTruthy();
    expect(weekPage?.querySelector(".day-split__main")).toBeNull();
    expect(weekPage?.querySelector(".agents-rhythm-chart")).toBeNull();
    expect(weekPage?.querySelector(".app-usage-panel")).toBeNull();
    expect(weekPage?.querySelector(".agents-week-calendar__foot")).toBeNull();
  });

  it("keeps one Week tab stop and moves between runs with arrow keys", () => {
    vi.mocked(useAgentsData).mockReturnValue({
      days: [{
        ...source,
        turns: [
          [60, 120, "codex", "drifty_mac"],
          [180, 240, "claude", "other_repo"],
        ],
      }],
      loading: false,
      live: true,
    });
    renderAgentsPage();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const runs = screen.getAllByLabelText(/Agent run on Fri, 2026-08-28/i);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.getAttribute("tabindex"))).toEqual(["0", "-1"]);

    fireEvent.focus(runs[0]!);
    fireEvent.keyDown(runs[0]!, { key: "ArrowRight" });

    expect(document.activeElement).toBe(runs[1]);
    expect(runs.map((run) => run.getAttribute("tabindex"))).toEqual(["-1", "0"]);
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("other_repo");
  });

  it("updates the current-time marker without taking back a user's calendar scroll", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 12, 0, 0));
    renderAgentsPage();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const scroller = document.querySelector<HTMLElement>(".agents-week-calendar .week-v2-calendar__scroller");
    if (!scroller) throw new Error("Expected the week calendar scroller");
    scroller.scrollTop = 123;

    act(() => vi.advanceTimersByTime(60_000));

    expect(scroller.scrollTop).toBe(123);
  });

  it("rotates Day and Week from the configured day start and shows the live time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 28, 9, 17, 0));
    renderAgentsPage({ startOfDayMinutes: 4 * 60 });

    const dayHourLabels = Array.from(document.querySelectorAll<HTMLElement>(".agents-flow-card .flow-chart-hours > span"));
    expect(dayHourLabels[1]?.textContent).toMatch(/4\s*am/i);
    expect(document.querySelector(".agents-flow-card .flow-chart-hour--now")?.textContent).toMatch(/9\s*am/i);
    expect(document.querySelector(".agents-flow-card .flow-chart-row--now .flow-chart-row-label")?.textContent).toBe(":15");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const weekHourLabels = Array.from(document.querySelectorAll<HTMLElement>(".agents-week-calendar .week-v2-calendar__time-rail > span"));
    expect(weekHourLabels[0]?.textContent).toMatch(/4\s*am/i);
    expect(document.querySelector(".agents-week-calendar .week-v2-calendar__time-rail-endpoint")?.textContent).toMatch(/4\s*am/i);
    expect(screen.getByLabelText("Current time 9:17 AM")).toBeTruthy();
    expect(screen.getByLabelText(/Agent run on Fri, 2026-08-28/i).getAttribute("aria-label")).toContain("05:00–06:00");
  });

  it("keeps an after-midnight current time on the previous logical day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 2, 17, 0));
    renderAgentsPage({ startOfDayMinutes: 4 * 60 });

    expect(document.querySelector(".agents-flow-card .flow-chart-hour--now")?.textContent).toMatch(/2\s*am/i);
    expect(document.querySelector(".agents-flow-card .flow-chart-row--now .flow-chart-row-label")?.textContent).toBe(":15");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByLabelText("Current time 2:17 AM")).toBeTruthy();
  });

  it("shares the color mode across Day and Week and expands intensity through 50 concurrent turns", () => {
    const highConcurrencySource: AgentsDaySource = {
      ...source,
      turns: Array.from({ length: 50 }, (_, index) => [
        60,
        120,
        index % 2 === 0 ? "codex" : "claude",
        "drifty_mac",
      ] as const),
    };
    vi.mocked(useAgentsData).mockReturnValue({ days: [highConcurrencySource], loading: false, live: true });

    renderAgentsPage();

    expect(screen.getByText("×30–50")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("drifty_mac").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Intensity" }));
    expect(screen.getByText("×30–50")).toBeTruthy();
    const event = screen.getByLabelText(/Agent run on Fri, 2026-08-28, drifty_mac/i);
    expect(event.getAttribute("aria-label")).toContain("Claude Code + Codex, peak ×50");
    fireEvent(event, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("Peak ×50");
  });
});
