// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());
import type { ActivitySegment, Project } from "@drifty/domain";

import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { PROJECT_PASS_NO_RESULTS_MESSAGE, PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX } from "../classification/useProjectClassification";
import { ProjectsPage, type ProjectsPageProps } from "./ProjectsPage";
import { IDLE_PROJECT_AUTO_ANALYSIS } from "./projectAutoAnalysisState";
import { NO_PROJECT_MATCH_COOLDOWN } from "./projectMatchCooldown";

const DRIFTY: Project = { id: "p1", name: "Drifty", description: "Mac app", color: "#6366f1", status: "active", anchors: [], createdAt: "", updatedAt: "" };

function baseProps(overrides: Partial<ProjectsPageProps> = {}): ProjectsPageProps {
  return {
    projects: [],
    assignments: [],
    selectedDay: "2026-07-08",
    startOfDayMinutes: 240,
    daySegments: [],
    dayProjectBySegmentId: new Map(),
    trendSegments: [],
    trendProjectBySegmentId: new Map(),
    trendLoadedRange: null,
    projectsLoading: false,
    running: false,
    runError: null,
    analysisConnected: true,
    analysisSetup: DEFAULT_ANALYSIS_AI_SETUP,
    autoAnalysis: IDLE_PROJECT_AUTO_ANALYSIS,
    matchCooldown: NO_PROJECT_MATCH_COOLDOWN,
    onTrendWindowChange: vi.fn(),
    onConfigureModel: vi.fn(),
    onOpenTrends: vi.fn(),
    onEditProject: vi.fn(),
    onRunAnalysis: vi.fn(),
    ...overrides,
  };
}

const status = () => screen.getByRole("group", { name: "Project matching model" });
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Matching options" }));

describe("ProjectsPage", () => {
  it("asks for the category editor from the header and from a project's detail", () => {
    const props = baseProps({ projects: [DRIFTY] });
    render(<ProjectsPage {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(props.onEditProject).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));
    expect(screen.queryByText("Active")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(props.onEditProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("says nothing while matching is fine, keeping refresh and Intelligence settings in its menu", () => {
    const props = baseProps({ projects: [DRIFTY] });
    const { container } = render(<ProjectsPage {...props} />);

    expect(container.querySelector(".projects-model-status")).toBeNull();
    expect(status().textContent).toBe("");
    openMenu();
    expect(screen.getByRole("menuitem", { name: /^Intelligence settings/ }).textContent).toContain("Drifty Cloud");
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh latest 7 days" }));
    expect(props.onRunAnalysis).toHaveBeenCalledTimes(1);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Intelligence settings/ }));
    expect(props.onConfigureModel).toHaveBeenCalledTimes(1);
  });

  it("keeps a running refresh in the line and its menu item disabled", () => {
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], running: true })} />);

    expect(within(status()).getByRole("status").textContent).toBe("Matching the latest 7 days…");
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Refreshing…" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/chunk 1 of 3/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Explore in Insights/i })).toBeTruthy();
  });

  it("reports automatic matching while a new project is analyzed", () => {
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], running: true, autoAnalysis: { p1: "running" } })} />);

    expect(status().textContent).toContain("Matching the latest 7 days…");
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Matching…" })).toHaveProperty("disabled", true);
  });

  it("puts the retry in the line when automatic matching paused", () => {
    const onRunAnalysis = vi.fn();
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], autoAnalysis: { p1: "error" }, onRunAnalysis })} />);

    expect(status().textContent).toContain("Automatic matching paused");
    fireEvent.click(within(status()).getByRole("button", { name: "Retry latest 7 days" }));
    expect(onRunAnalysis).toHaveBeenCalledTimes(1);
  });

  it("asks for Intelligence settings in the line when the model is not ready", () => {
    const onConfigureModel = vi.fn();
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], analysisConnected: false, onConfigureModel })} />);

    expect(status().textContent).toContain("Intelligence needs setup");
    fireEvent.click(within(status()).getByRole("button", { name: "Open settings" }));
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
  });

  it("lets a member with only team projects refresh assignments", () => {
    const onRunAnalysis = vi.fn();
    const { rerender } = render(<ProjectsPage {...baseProps({ onRunAnalysis })} />);
    openMenu();
    const disabled = screen.getByRole("menuitem", { name: "Refresh latest 7 days" });
    expect(disabled).toHaveProperty("disabled", true);
    expect(disabled.getAttribute("title")).toMatch(/Create at least one active project/i);

    // The pass matches against team projects too, so they enable it on their own.
    rerender(<ProjectsPage {...baseProps({ onRunAnalysis, activeTeamProjectCount: 1 })} />);
    const enabled = screen.getByRole("menuitem", { name: "Refresh latest 7 days" });
    expect(enabled).toHaveProperty("disabled", false);
    fireEvent.click(enabled);
    expect(onRunAnalysis).toHaveBeenCalledTimes(1);
  });

  it("blocks a redundant refresh right after a completed pass", () => {
    const onRunAnalysis = vi.fn();
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], matchCooldown: { active: true, remainingSeconds: 72 }, onRunAnalysis })} />);

    expect(status().textContent).toBe("");
    openMenu();
    const action = screen.getByRole("menuitem", { name: /Just matched/i });
    expect(action).toHaveProperty("disabled", true);
    expect(action.getAttribute("title")).toMatch(/already up to date/i);
    fireEvent.click(action);
    expect(onRunAnalysis).not.toHaveBeenCalled();
  });

  it("keeps a queued burst clickable even inside the cooldown window", () => {
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], autoAnalysis: { p1: "queued" }, matchCooldown: { active: true, remainingSeconds: 30 } })} />);

    expect(status().textContent).toContain("Matching soon");
    expect(within(status()).getByRole("button", { name: "Match now" })).toHaveProperty("disabled", false);
  });

  it("keeps a failed run retryable even inside the cooldown window", () => {
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], autoAnalysis: { p1: "error" }, matchCooldown: { active: true, remainingSeconds: 30 } })} />);

    expect(within(status()).getByRole("button", { name: "Retry latest 7 days" })).toHaveProperty("disabled", false);
  });

  it("uses one seven-day window for the overview, project totals, and the time that went to no project", () => {
    // The list ends today; the fixture's selected day is that today.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-08T12:00:00"));
    const onOpenTrends = vi.fn();
    const onTrendWindowChange = vi.fn();
    const trendSegments = [
      { id: "older", startedAt: "2026-06-28T09:00:00", endedAt: "2026-06-28T10:00:00", durationSeconds: 3600, appName: "App" },
      { id: "recent", startedAt: "2026-07-08T09:00:00", endedAt: "2026-07-08T11:00:00", durationSeconds: 7200, appName: "App" },
      { id: "loose", startedAt: "2026-07-07T09:00:00", endedAt: "2026-07-07T10:00:00", durationSeconds: 3600, appName: "Safari" },
    ] as ActivitySegment[];
    render(
      <ProjectsPage
        {...baseProps({
          projects: [DRIFTY],
          trendSegments,
          trendProjectBySegmentId: new Map([["older", "p1"], ["recent", "p1"]]),
          trendLoadedRange: { startDay: "2026-07-02", endDay: "2026-07-08" },
          onTrendWindowChange,
          onOpenTrends,
        })}
      />,
    );

    expect(onTrendWindowChange).toHaveBeenCalledWith({ startDay: "2026-07-02", endDay: "2026-07-08" });
    // Under the list: the week's chart and, beside it, the split between projects only (no "No project").
    const share = screen.getByRole("region", { name: "Project share · latest 7 days" });
    expect(share.textContent).toContain("2h");
    expect(share.textContent).toContain("100%");
    expect(within(share).queryByText("No project")).toBeNull();
    expect(screen.getByRole("img", { name: "Drifty, latest 7 days" })).toBeTruthy();
    const projectTable = screen.getByRole("region", { name: "Projects" });
    expect(within(projectTable).getByText("Time · latest 7 days")).toBeTruthy();
    expect(within(projectTable).getByText("2h")).toBeTruthy();
    expect(within(projectTable).queryByText("3h")).toBeNull();
    // Time with no project stays out of the project list (Insights shows it).
    expect(within(projectTable).queryByText("No project")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Explore in Insights/i }));
    expect(onOpenTrends).toHaveBeenCalledTimes(1);
  });

  it("keeps the project list on the latest seven days whatever day the calendar selected", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T12:00:00"));
    const onTrendWindowChange = vi.fn();
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], selectedDay: "2026-07-08", onTrendWindowChange })} />);
    expect(onTrendWindowChange).toHaveBeenCalledWith({ startDay: "2026-07-14", endDay: "2026-07-20" });
  });

  it("opens a project's detail on the same latest seven days, whatever day the calendar selected", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T12:00:00"));
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], selectedDay: "2026-07-08" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));
    expect(screen.getByText("Jul 14–20")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Today" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Show previous project window" }));
    expect(screen.getByText("Jul 7–13")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Today" })).toHaveProperty("disabled", false);
  });

  it("steps through projects in the table's order from a project's detail, and returns to its page", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ ...DRIFTY, id: "p" + index, name: "Work " + (index + 1) }));
    render(<ProjectsPage {...baseProps({ projects: many })} />);

    fireEvent.click(screen.getByRole("button", { name: "Next page of projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Work 27 project" }));
    expect(screen.getByRole("heading", { name: "Work 27" })).toBeTruthy();
    expect(screen.getByText("27 / 30")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next project" }));
    expect(screen.getByRole("heading", { name: "Work 28" })).toBeTruthy();
    expect(screen.getByText("28 / 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous project" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous project" }));
    expect(screen.getByRole("heading", { name: "Work 26" })).toBeTruthy();

    // The detail keeps the Projects title where the table has it.
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
    expect(screen.getByText("16–30 of 30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Work 26 project" })).toBeTruthy();
  });

  it("switches to another project from the name's menu, searching a long library", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ ...DRIFTY, id: "p" + index, name: "Work " + (index + 1) }));
    render(<ProjectsPage {...baseProps({ projects: many })} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Work 2 project" }));

    const name = screen.getByRole("button", { name: "Work 2" });
    expect(name.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(name);
    const menu = screen.getByRole("menu", { name: "Projects" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(12);
    expect(within(menu).getByRole("menuitemradio", { name: "Work 2" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(within(menu).getByRole("textbox", { name: "Search project name" }), { target: { value: "work 1" } });
    // Work 1, 10, 11 and 12.
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Work 11" }));
    expect(screen.queryByRole("menu", { name: "Projects" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Work 11" })).toBeTruthy();
    expect(screen.getByText("11 / 12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Work 11" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Projects" })).toBeNull();
  });

  it("makes a project in its own dialog, then shows the page that holds it with its row marked", async () => {
    const many = Array.from({ length: 16 }, (_, index) => ({ ...DRIFTY, id: "p" + index, name: "Work " + (index + 1) }));
    const onSaveProject = vi.fn(async () => ({ saved: true as const, id: "made" }));
    const props = baseProps({ projects: many, onSaveProject });
    const { container, rerender } = render(<ProjectsPage {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search project name" }), { target: { value: "work 3" } });

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    // Only the project's own fields: no other projects and no category or productivity tabs.
    expect(within(dialog).queryByRole("tab")).toBeNull();
    expect(within(dialog).queryByText("Work 1")).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Create project/ })).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Podcast  " } });
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: "Recording and show notes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create project/ }));

    await waitFor(() => expect(onSaveProject).toHaveBeenCalledWith(expect.objectContaining({ name: "Podcast", description: "Recording and show notes", status: "active" })));
    expect(props.onEditProject).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New project" })).toBeNull());

    // The library reloads with the project last; the table clears its search and turns to its page.
    rerender(<ProjectsPage {...props} projects={[...many, { ...DRIFTY, id: "made", name: "Podcast" }]} />);
    await waitFor(() => expect(screen.getByText("16–17 of 17")).toBeTruthy());
    expect((screen.getByRole("textbox", { name: "Search project name" }) as HTMLInputElement).value).toBe("");
    expect(container.querySelector(".projects-table__row.is-just-made")?.textContent).toContain("Podcast");
  });

  it("keeps the New project dialog and its input when saving fails", async () => {
    const onSaveProject = vi.fn(async () => ({ saved: false as const, error: "Could not save. Your changes are kept. Try again.", detail: "database is locked" }));
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], onSaveProject })} />);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Podcast" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Create project/ }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Could not save. Your changes are kept. Try again.");
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Podcast");
    expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();
  });

  it("starts an empty page with one title, one line and New project", () => {
    const props = baseProps();
    render(<ProjectsPage {...props} />);

    expect(screen.getByRole("heading", { name: "Make your first project" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(props.onEditProject).toHaveBeenCalledWith(null);
  });

  it("holds the table's place instead of the empty page while the library first loads", () => {
    const { container } = render(<ProjectsPage {...baseProps({ projectsLoading: true, intelligenceLocked: true })} />);

    expect(container.querySelector(".projects-manager--loading .projects-table__head")).toBeTruthy();
    expect(container.querySelectorAll(".projects-manager--loading .projects-table__row")).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "Make your first project" })).toBeNull();
    expect(screen.queryByText("Connect Intelligence and each project gathers its time")).toBeNull();
  });

  it("waits on the window's activity before showing project times or an empty share", () => {
    const { container } = render(<ProjectsPage {...baseProps({ projects: [DRIFTY], trendLoadedRange: null })} />);

    const projectTable = screen.getByRole("region", { name: "Projects" });
    expect(projectTable.querySelector(".pt-trend-loading")).toBeTruthy();
    expect(within(projectTable).queryByText("0m")).toBeNull();
    const share = screen.getByRole("region", { name: "Project share · latest 7 days" });
    expect(share.getAttribute("aria-busy")).toBe("true");
    expect(share.querySelectorAll(".projects-share__legend li")).toHaveLength(1);
    expect(container.querySelector(".projects-share__empty")).toBeNull();

    // A project's detail waits the same way instead of reading zero or "no time".
    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));
    expect(container.querySelector(".pd-layout")?.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("No time in this range")).toBeNull();
    // The four figures and the change line are all placeholders, none a measured zero.
    expect(container.querySelectorAll(".pd-kpi .metric-tile")).toHaveLength(4);
    expect(container.querySelector(".pd-change .loading-skeleton-text")).toBeTruthy();
  });

  it("puts one slim line over the ordinary empty page without Intelligence", () => {
    const props = baseProps({ intelligenceLocked: true, onSaveProject: vi.fn() });
    render(<ProjectsPage {...props} />);

    const line = screen.getByText("Connect Intelligence and each project gathers its time").parentElement!;
    fireEvent.click(within(line).getByRole("button", { name: "Connect" }));
    expect(props.onConfigureModel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Make your first project" })).toBeTruthy();
    // New project opens the editor, which shows its own lock, instead of the New project dialog.
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(props.onEditProject).toHaveBeenCalledWith(null);
    expect(props.onSaveProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "New project" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Project matching model" })).toBeNull();
  });

  it("says why projects stopped gathering time in one line over the list, with the way back", () => {
    const onPickIntelligence = vi.fn();
    const onConfigureModel = vi.fn();
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], intelligenceLocked: true, lockReason: "trial-ended", onPickIntelligence, onConfigureModel })} />);

    const line = screen.getByText("Your trial ended, so new activity isn't gathered into projects").parentElement!;
    fireEvent.click(within(line).getByRole("button", { name: "See Pro plans" }));
    expect(onPickIntelligence).toHaveBeenCalledWith("cloud");
    fireEvent.click(within(line).getByRole("button", { name: "Use my API key" }));
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe("");
    expect(screen.getByRole("region", { name: "Projects" })).toBeTruthy();
    // The editor keeps projects closed without Intelligence, so the page offers no way into it.
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Drifty" })).toBeNull();
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Refresh latest 7 days" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Intelligence settings" })).toBeTruthy();
  });

  it("names a key that stopped working without leading to plans", () => {
    const onConfigureModel = vi.fn();
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], intelligenceLocked: true, lockReason: "disconnected", onPickIntelligence: vi.fn(), onConfigureModel })} />);

    const line = screen.getByText("Intelligence is disconnected, so new activity isn't gathered").parentElement!;
    expect(within(line).queryByRole("button", { name: "See Pro plans" })).toBeNull();
    fireEvent.click(within(line).getByRole("button", { name: "Reconnect" }));
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
  });

  it("loads eight weeks for a project's detail and compares its time with the window before", () => {
    // The detail opens on the latest window; the fixture's day is today.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-08T12:00:00"));
    const onTrendWindowChange = vi.fn();
    const trendSegments = [
      { id: "now", startedAt: "2026-07-08T09:00:00", endedAt: "2026-07-08T11:00:00", durationSeconds: 7200, appName: "App" },
      { id: "before", startedAt: "2026-06-28T09:00:00", endedAt: "2026-06-28T10:00:00", durationSeconds: 3600, appName: "App" },
    ] as ActivitySegment[];
    const props = baseProps({
      projects: [DRIFTY],
      trendSegments,
      trendProjectBySegmentId: new Map([["now", "p1"], ["before", "p1"]]),
      trendLoadedRange: { startDay: "2026-07-02", endDay: "2026-07-08" },
      onTrendWindowChange,
    });
    const { rerender } = render(<ProjectsPage {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));

    // The detail loads the eight weeks its recent trend covers, which hold the
    // window before too, and compares once they are in.
    expect(onTrendWindowChange).toHaveBeenLastCalledWith({ startDay: "2026-05-14", endDay: "2026-07-08" });
    rerender(<ProjectsPage {...props} trendLoadedRange={{ startDay: "2026-05-14", endDay: "2026-07-08" }} />);
    expect(screen.getByText("1h more than the previous 7 days")).toBeTruthy();

    // A month's window before reaches further back than eight weeks.
    fireEvent.click(screen.getByRole("radio", { name: "Month" }));
    expect(onTrendWindowChange).toHaveBeenLastCalledWith({ startDay: "2026-05-10", endDay: "2026-07-08" });
  });

  it("leaves time after projects stopped out of a project's detail, as its row does", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-08T12:00:00"));
    const trendSegments = [
      { id: "kept", startedAt: "2026-07-06T09:00:00", endedAt: "2026-07-06T10:00:00", durationSeconds: 3600, appName: "App" },
      { id: "after", startedAt: "2026-07-08T09:00:00", endedAt: "2026-07-08T11:00:00", durationSeconds: 7200, appName: "App" },
    ] as ActivitySegment[];
    const props = baseProps({
      projects: [DRIFTY],
      intelligenceLocked: true,
      lockReason: "signed-out",
      stoppedSinceDay: "2026-07-07",
      trendSegments,
      trendProjectBySegmentId: new Map([["kept", "p1"], ["after", "p1"]]),
      trendLoadedRange: { startDay: "2026-07-02", endDay: "2026-07-08" },
    });
    const { rerender } = render(<ProjectsPage {...props} />);
    expect(within(screen.getByRole("region", { name: "Projects" })).getByText("1h")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));
    rerender(<ProjectsPage {...props} trendLoadedRange={{ startDay: "2026-05-14", endDay: "2026-07-08" }} />);
    expect(document.body.textContent).not.toContain("3h");
    expect(screen.getAllByText("1h").length).toBeGreaterThan(0);
  });

  it("keeps project action errors visible in both the library and project detail", () => {
    render(<ProjectsPage {...baseProps({ projects: [DRIFTY], runError: "Could not save the project." })} />);

    expect(screen.getByRole("alert").textContent).toBe("Could not save the project.");
    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));
    expect(screen.getByRole("alert").textContent).toBe("Could not save the project.");
  });

  it("translates a tracker failure but keeps a provider's own message as written", () => {
    const { rerender } = render(<ProjectsPage {...baseProps({ runError: "database is locked" })} />);
    const alert = screen.getByRole("alert");
    expect(alert.firstChild?.textContent).toBe("Another task was using the activity database. Try again in a moment.");
    expect(alert.getAttribute("title")).toBe("database is locked");

    rerender(<ProjectsPage {...baseProps({ runError: "Invalid API key" })} />);
    expect(screen.getByRole("alert").textContent).toBe("Invalid API key");

    rerender(<ProjectsPage {...baseProps({ runError: PROJECT_PASS_NOTHING_TO_ANALYZE_PREFIX + "no activity in range." })} />);
    expect(screen.getByRole("alert").textContent).toBe("Nothing to analyze in this range.");
  });

  it("localizes the empty project-pass result and points to the Intelligence settings section", () => {
    render(<LocalizationTestProvider language="ko"><ProjectsPage {...baseProps({ runError: PROJECT_PASS_NO_RESULTS_MESSAGE })} /></LocalizationTestProvider>);

    expect(screen.getByRole("alert").textContent).toBe("분석 모델이 결과를 돌려주지 않았어요. 설정 › Intelligence에서 API 키와 모델을 확인한 뒤 다시 시도해 주세요.");
  });
});
