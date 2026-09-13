// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsDaySource } from "./agentsPageModel";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";
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

function renderAgentsPage(
  overrides: Partial<Parameters<typeof AgentsPage>[0]> = {},
  language: DisplayLanguage = "en",
) {
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
  render(
    <LocalizationTestProvider language={language}>
      <AgentsPage {...props} />
    </LocalizationTestProvider>,
  );
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

  it("renders the Day and Week agent surfaces in Korean", () => {
    renderAgentsPage({}, "ko");

    expect(screen.getByRole("heading", { name: "에이전트 작업량 1시간" }).textContent).toBe("에이전트 작업1시간");
    expect(screen.getAllByText("실제 경과 1시간 · 최대 1개 동시 실행").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "이전 에이전트 날짜 보기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "오늘" })).toBeTruthy();
    expect(screen.getByText("에이전트 리듬 · 시간대별")).toBeTruthy();
    expect(screen.getByText("가장 활발한 저장소")).toBeTruthy();
    expect(screen.getByText("순 코드 줄")).toBeTruthy();

    const dayRun = document.querySelector('[data-flow-minute="108"]')!;
    fireEvent(dayRun, new MouseEvent("pointermove", { bubbles: true, clientX: 80, clientY: 80 }));
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("최대 동시 실행×1");
    expect(document.querySelector(".agents-hover-card__repos")?.textContent).toContain("drifty_macCodex");
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("모델gpt-5");
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("커밋1");

    fireEvent.click(screen.getByRole("button", { name: "주간" }));

    expect(screen.getByRole("button", { name: "이전 에이전트 주 보기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "이번 주" })).toBeTruthy();
    expect(screen.getByLabelText("에이전트 주간 캘린더")).toBeTruthy();
    const weekRun = screen.getByLabelText(/금 2026-08-28 에이전트 실행/);
    expect(weekRun.getAttribute("aria-label")).toContain("활성 1시간");
    fireEvent(weekRun, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("활성 1시간");
    expect(screen.queryByText("Agent rhythm · by hour")).toBeNull();
  });

  it("opens SSH collection with local config discovery and a custom-host fallback", async () => {
    renderAgentsPage();

    const sshButton = screen.getByRole("button", { name: "Add an SSH agent source" });
    expect(document.querySelector(".dashboard-page-head__primary")?.contains(sshButton)).toBe(true);
    expect(document.querySelector(".dashboard-page-head__side")?.contains(sshButton)).toBe(false);
    fireEvent.click(sshButton);

    expect(screen.getByRole("dialog", { name: "Collect from SSH" })).toBeTruthy();
    expect(screen.getByText(/Hosts are read locally/).textContent).toContain("~/.ssh/config");
    expect(screen.getByLabelText("Host or alias")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collect & keep synced" }).hasAttribute("disabled")).toBe(true);
    expect(await screen.findByText(/SSH config discovery is available in the Drifty desktop app/)).toBeTruthy();
  });

  it("shows continuous and active SSH collection feedback beside the add button", () => {
    const { rerender } = render(
      <LocalizationTestProvider language="ko">
        <AgentsPage
          flowIntervalMinutes={3}
          onFlowIntervalChange={vi.fn()}
          onSelectDay={vi.fn()}
          selectedDay="2026-08-28"
          startOfDayMinutes={0}
          startOfWeek="monday"
          todayDay="2026-08-28"
          sshSyncStatus={{
            autoSyncEnabled: true,
            sourceCount: 2,
            sourceHosts: ["lab-host", "10.0.0.8"],
            activeHosts: [],
            syncing: false,
            revision: 0,
            lastSuccessAt: "2026-08-28T12:00:00.000Z",
            lastErrorHost: null,
            lastError: null,
          }}
        />
      </LocalizationTestProvider>,
    );

    const sshButton = screen.getByRole("button", { name: "SSH 에이전트 소스 추가" });
    expect(screen.getByRole("status").textContent).toContain("lab-host+1");
    expect(screen.getByRole("status").querySelector(".sr-only")?.textContent).toContain("SSH 소스 lab-host");
    expect(document.querySelector(".agents-ssh-controls")?.contains(sshButton)).toBe(true);

    rerender(
      <LocalizationTestProvider language="ko">
        <AgentsPage
          flowIntervalMinutes={3}
          onFlowIntervalChange={vi.fn()}
          onSelectDay={vi.fn()}
          selectedDay="2026-08-28"
          startOfDayMinutes={0}
          startOfWeek="monday"
          todayDay="2026-08-28"
          sshSyncStatus={{
            autoSyncEnabled: true,
            sourceCount: 2,
            sourceHosts: ["lab-host", "10.0.0.8"],
            activeHosts: ["10.0.0.8"],
            syncing: true,
            revision: 0,
            lastSuccessAt: "2026-08-28T12:00:00.000Z",
            lastErrorHost: null,
            lastError: null,
          }}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain("10.0.0.8");
    expect(screen.getByRole("status").querySelector(".sr-only")?.textContent).toContain("10.0.0.8에서");
    expect(document.querySelector(".agents-ssh-sync-status")?.classList.contains("is-syncing")).toBe(true);

    rerender(
      <LocalizationTestProvider language="ko">
        <AgentsPage
          flowIntervalMinutes={3}
          onFlowIntervalChange={vi.fn()}
          onSelectDay={vi.fn()}
          selectedDay="2026-08-28"
          startOfDayMinutes={0}
          startOfWeek="monday"
          todayDay="2026-08-28"
          sshSyncStatus={{
            autoSyncEnabled: true,
            sourceCount: 2,
            sourceHosts: ["lab-host", "10.0.0.8"],
            activeHosts: [],
            syncing: false,
            revision: 0,
            lastSuccessAt: "2026-08-28T12:00:00.000Z",
            lastErrorHost: "10.0.0.8",
            lastError: "Timed out.",
          }}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain("10.0.0.8+1");
    expect(screen.getByRole("status").querySelector(".sr-only")?.textContent).toContain("자동 수집에 실패");
    expect(document.querySelector(".agents-ssh-sync-status")?.classList.contains("is-error")).toBe(true);
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
    expect(heading.textContent).toBe("Agent work");
    expect(heading.querySelector(".loading-skeleton-line--metric")).toBeTruthy();
    expect(screen.queryByText("Loading agent activity")).toBeNull();
    expect(screen.queryByText(/sample/i)).toBeNull();
    expect(document.querySelector(".page--agents")?.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps Agent work visible when the requested day is still loading", () => {
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

    expect(screen.getByRole("heading", { name: "1.0h of agent work" }).textContent).toBe("Agent work1.0h");

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
    expect(loadingHeading.textContent).toBe("Agent work");
    expect(loadingHeading.querySelector(".loading-skeleton-line--metric")).toBeTruthy();
    expect(screen.queryByText("Loading agent activity")).toBeNull();
  });

  it("counts concurrent agents independently in the headline", () => {
    vi.mocked(useAgentsData).mockReturnValue({
      days: [{
        ...source,
        turns: [
          [60, 120, "codex", "drifty_mac"],
          [60, 120, "claude_code", "drifty_mac"],
          [60, 120, "gemini", "drifty_mac"],
          [60, 120, "opencode", "drifty_mac"],
        ],
      }],
      loading: false,
      live: true,
    });

    renderAgentsPage();

    expect(screen.getByRole("heading", { name: "4.0h of agent work" }).textContent).toBe("Agent work4.0h");
    expect(screen.getAllByText("1.0h elapsed · peak ×4 concurrent").length).toBeGreaterThan(0);
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

    const dayRun = screen.getByRole("img", { name: /Agent activity, drifty_mac/i });
    expect(dayRun.getAttribute("aria-label")).toContain("01:00–01:03, <1m active");
    fireEvent(dayRun, new MouseEvent("pointermove", { bubbles: true, clientX: 80, clientY: 80 }));
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("<1m active");

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByLabelText(/Agent run on Fri, 2026-08-28/i).getAttribute("aria-label"))
      .toContain("01:00–01:01, <1m active");
  });

  it("shows cell facts in Day and the whole run in Week", async () => {
    renderAgentsPage();

    const dayCell = screen.getByRole("img", { name: /Agent activity, drifty_mac, 01:00–02:00/i });
    fireEvent(dayCell, new MouseEvent("pointermove", { bubbles: true, clientX: 80, clientY: 80 }));
    await waitFor(() => expect(document.querySelector(".agents-hover-card")?.textContent).toContain("drifty_mac"));
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("Peak concurrent×1");
    expect(document.querySelector(".agents-hover-card__head strong")?.textContent).toBe("01:00–02:00");
    expect(document.querySelector(".agents-hover-card__head")?.textContent).toContain("1h active");
    expect(document.querySelector(".agents-hover-card__facts")?.textContent).toContain("Commits in interval1");
    expect(document.querySelector(".agents-hover-card")?.textContent).not.toContain("Workspace");
    expect(document.querySelector(".agents-hover-card")?.textContent).not.toContain("Delete activity");
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    const weekRun = screen.getByLabelText(/Agent run on Fri, 2026-08-28, drifty_mac, Codex/i);
    fireEvent(weekRun, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    await waitFor(() => expect(document.querySelector(".agents-hover-card")?.textContent).toContain("drifty_mac"));
    expect(document.querySelector(".agents-hover-card")?.textContent).not.toContain("Not classified yet");
    expect(weekRun.getAttribute("aria-label")).toContain("1.0h active");

    fireEvent.focus(weekRun);
    fireEvent.blur(weekRun);
    await waitFor(() => expect(document.querySelector(".agents-hover-card")).toBeNull());

    const calendarBody = document.querySelector(".week-v2-calendar__body");
    if (!calendarBody) throw new Error("Expected the week calendar body");
    fireEvent(weekRun, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    await waitFor(() => expect(document.querySelector(".agents-hover-card")?.textContent).toContain("drifty_mac"));
    fireEvent.pointerLeave(calendarBody);
    await waitFor(() => expect(document.querySelector(".agents-hover-card")).toBeNull());
    fireEvent.focus(weekRun);
    await waitFor(() => expect(document.querySelector(".agents-hover-card")?.textContent).toContain("drifty_mac"));
    fireEvent.pointerLeave(calendarBody);
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("drifty_mac");
    fireEvent.keyDown(weekRun, { key: "Escape" });
    expect(document.querySelector(".agents-hover-card")).toBeNull();
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

  it("paints a week run with its cells without adding keyboard stops", async () => {
    vi.mocked(useAgentsData).mockReturnValue({
      days: [{
        ...source,
        attention: [],
        // One uninterrupted run whose second half runs two agents at once:
        // the block must not read as a single flat rectangle.
        turns: [
          [60, 120, "codex", "drifty_mac", "gpt-5", 1_000],
          [90, 120, "claude_code", "drifty_mac", "claude", 1_000],
        ],
        commits: [],
      }],
      loading: false,
      live: true,
    });
    renderAgentsPage();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    const run = document.querySelector(".agents-week-calendar__event--segmented");
    if (!run) throw new Error("Expected a segmented week run");
    const segments = run.querySelectorAll(".agents-week-calendar__segment");
    expect(segments.length).toBeGreaterThan(1);
    const tones = new Set([...segments].map((segment) => segment.getAttribute("data-agent-intensity-band")));
    expect(tones.size).toBeGreaterThan(1);
    // The run stays the only focus target; cells are pointer surfaces only.
    expect(run.querySelectorAll("[tabindex]")).toHaveLength(0);
    expect(document.querySelectorAll('.agents-week-calendar__event[tabindex="0"]')).toHaveLength(1);

    const segment = segments[segments.length - 1]!;
    fireEvent(segment, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    await waitFor(() => expect(document.querySelector(".agents-hover-card")).toBeTruthy());
  });

  it("retargets a single highlighted cell across parallel repos and preserves its color", async () => {
    vi.mocked(useAgentsData).mockReturnValue({ days: [{
      ...source, attention: [],
      turns: [
        [600, 640, "codex", "alpha", "model-a", 0],
        [620, 650, "claude", "beta", "model-b", 0],
        [623, 624, "gemini", "gamma", "model-c", 0],
      ],
      commits: [[622, 1, 0, 1, "inside", "beta"], [624, 1, 0, 1, "outside", "gamma"]],
    }], loading: false, live: true });
    renderAgentsPage();
    const mixed = document.querySelector<HTMLElement>('[data-flow-minute="621"]')!;
    fireEvent(mixed, new MouseEvent("pointermove", { bubbles: true }));
    expect(screen.getByRole("tooltip").textContent).toContain("Peak concurrent×3");
    expect(document.querySelector(".agents-hover-card__repos")?.textContent).toContain("alphaCodexbetaClaude CodeAdditional repos: 1");
    expect(screen.getByRole("tooltip").textContent).toContain("Commits in interval1");
    const overlays = document.querySelectorAll<HTMLElement>(".flow-hover-group-highlight");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.style.getPropertyValue("--flow-hover-row-span")).toBe("1");

    const later = document.querySelector<HTMLElement>('[data-flow-minute="642"]')!;
    fireEvent(later, new MouseEvent("pointermove", { bubbles: true }));
    await waitFor(() => expect(document.querySelector(".agents-hover-card__head strong")?.textContent).toBe("10:42–10:51"));
    expect(screen.getByRole("tooltip").textContent).toContain("Peak concurrent×1");
    expect(screen.getByRole("tooltip").textContent).not.toMatch(/alpha|model-a|Commits in interval/);
    act(() => later.focus());
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(later.dataset.agentHoverId).toContain(":cell:642:9");
    expect(document.querySelector<HTMLElement>(".agents-hover-card__tone")?.style.getPropertyValue("--agents-hover-tone"))
      .toBe(later.style.getPropertyValue("--flow-project-color"));
  });

  it("offers one Day tab stop and navigates cells in logical time across midnight", () => {
    vi.mocked(useAgentsData).mockReturnValue({ days: [{ ...source,
      turns: [
        [1197, 1200, "codex", "alpha", "model-a"],
        [1200, 1203, "codex", "alpha", "model-b"],
        [1203, 1206, "claude", "beta", "model-c"],
      ],
      commits: [],
    }], loading: false, live: true });
    renderAgentsPage({ startOfDayMinutes: 4 * 60 });
    const first = screen.getByRole("img", { name: /23:57–00:00/ });
    const next = screen.getByRole("img", { name: /00:00–00:03/ });
    expect(document.querySelectorAll('.agents-flow-card [data-agent-hover-id][tabindex="0"]')).toHaveLength(1);
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(next);
    expect(next.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    expect(document.querySelector(".agents-hover-card__head strong")?.textContent).toBe("00:00–00:03");
    fireEvent.keyDown(next, { key: "End" });
    expect(document.activeElement?.getAttribute("aria-label")).toContain("00:03–00:06");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not invent one surrounding run for two separate runs inside a coarse cell", () => {
    vi.mocked(useAgentsData).mockReturnValue({ days: [{ ...source,
      turns: [[600, 600.1, "codex", "alpha"], [605.9, 610, "claude", "beta"]], commits: [],
    }], loading: false, live: true });
    renderAgentsPage({ flowIntervalMinutes: 6 });
    fireEvent.focus(screen.getByRole("img", { name: /10:00–10:06/ }));
    expect(screen.getByRole("tooltip").textContent).toContain("Peak concurrent×1");
    expect(document.querySelector(".agents-hover-card__context")).toBeNull();
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
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("other_repo");
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
    const projectEvent = screen.getByLabelText(/Agent run on Fri, 2026-08-28, drifty_mac/i);
    const projectEventId = projectEvent.getAttribute("data-agent-hover-id");
    const projectEventLabel = projectEvent.getAttribute("aria-label");

    fireEvent.click(screen.getByRole("button", { name: "Intensity" }));
    expect(screen.getByText("×30–50")).toBeTruthy();
    const event = screen.getByLabelText(/Agent run on Fri, 2026-08-28, drifty_mac/i);
    expect(event.getAttribute("data-agent-hover-id")).toBe(projectEventId);
    expect(event.getAttribute("aria-label")).toBe(projectEventLabel);
    expect(event.getAttribute("aria-label")).toContain("Claude Code + Codex, peak ×50");
    fireEvent(event, new MouseEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(document.querySelector(".agents-hover-card")?.textContent).toContain("Peak×50");
  });

  it("displays peak commits in the rhythm chart legend", () => {
    renderAgentsPage();
    // source has 3 commits total, and rhythm histogram computes peak per hour
    expect(screen.getByText(/Commits · peak/i)).toBeTruthy();
  });

  it("shows active agent repo notice when agent ran but no commits were created", () => {
    const noCommitSource: AgentsDaySource = {
      ...source,
      commits: [],
      turns: [
        [60, 120, "codex", "drifty_mac"],
      ],
    };
    vi.mocked(useAgentsData).mockReturnValue({ days: [noCommitSource], loading: false, live: true });

    renderAgentsPage();

    expect(screen.getByText(/Agents ran in drifty_mac/i)).toBeTruthy();
  });
});
