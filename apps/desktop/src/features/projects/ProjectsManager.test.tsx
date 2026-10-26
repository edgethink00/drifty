// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@drifty/domain";

import { ProjectsManager, type ProjectsManagerProps } from "./ProjectsManager";
import { IDLE_PROJECT_AUTO_ANALYSIS } from "./projectAutoAnalysisState";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Drifty",
    description: "The Drifty desktop app — Tauri shell, tracker, dashboards, and releases.",
    color: "#6366f1",
    status: "active",
    anchors: [
      { kind: "app", value: "Visual Studio Code", source: "manual" },
      { kind: "domain", value: "github.com", source: "harvested" },
    ],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function baseProps(overrides: Partial<ProjectsManagerProps> = {}): ProjectsManagerProps {
  return {
    projects: [project()],
    totalSecondsByProject: new Map([["p1", 5 * 3600 + 30 * 60]]),
    lastActivityByProject: new Map([["p1", "2026-07-10"]]),
    totalCaption: "Latest 7 days",
    today: "2026-07-11",
    autoAnalysis: IDLE_PROJECT_AUTO_ANALYSIS,
    onEditProject: vi.fn(),
    onOpenProject: vi.fn(),
    ...overrides,
  };
}

describe("ProjectsManager", () => {
  it("hands a row's pencil to the category editor without opening the project", () => {
    const props = baseProps();
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Drifty" }));
    expect(props.onEditProject).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", name: "Drifty" }));
    expect(props.onOpenProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders a labeled list with last activity in words and the fixed seven-day window", () => {
    render(<ProjectsManager {...baseProps()} />);

    const projectList = screen.getByRole("region", { name: "Projects" });
    expect(within(projectList).getByText("Last activity")).toBeTruthy();
    expect(within(projectList).getByText("Time · Latest 7 days")).toBeTruthy();
    expect(within(projectList).getByText("Drifty")).toBeTruthy();
    expect(within(projectList).getByText("Yesterday")).toBeTruthy();
    expect(within(projectList).getByText("5h 30m")).toBeTruthy();
    expect(within(projectList).queryByText("Active")).toBeNull();
    expect(within(projectList).queryByText("Status")).toBeNull();
  });

  it("says today, days ago within the week, and a short date before that", () => {
    render(<ProjectsManager {...baseProps({
      projects: [project(), project({ id: "p2", name: "Blog" }), project({ id: "p3", name: "Old" })],
      lastActivityByProject: new Map([["p1", "2026-07-11"], ["p2", "2026-07-08"], ["p3", "2026-06-30"]]),
    })} />);

    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("3 days ago")).toBeTruthy();
    expect(screen.getByText("Jun 30")).toBeTruthy();
  });

  it("opens the project detail on row click", () => {
    const props = baseProps();
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByText("Drifty"));
    expect(props.onOpenProject).toHaveBeenCalledWith("p1");
  });

  it("exposes project details as a native primary action", () => {
    const props = baseProps();
    render(<ProjectsManager {...props} />);

    const openProject = screen.getByRole("button", { name: "Open Drifty project" });
    openProject.focus();
    expect(document.activeElement).toBe(openProject);
    fireEvent.click(openProject);
    expect(props.onOpenProject).toHaveBeenCalledWith("p1");
  });

  it("folds archived projects under the list", () => {
    render(<ProjectsManager {...baseProps({
      projects: [project(), project({ id: "p2", name: "Blog relaunch", status: "archived", anchors: [] })],
    })} />);

    expect(screen.queryByText("Blog relaunch")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Archived 1/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(within(screen.getByRole("region", { name: "Archived" })).getByText("Blog relaunch")).toBeTruthy();
  });

  it("keeps one table at every size: search and New project over it, the rows shown and pages under it", () => {
    const onCreateProject = vi.fn();
    render(<ProjectsManager {...baseProps({ onCreateProject })} />);

    expect(screen.getByRole("textbox", { name: "Search project name" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous page of projects" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Next page of projects" })).toHaveProperty("disabled", true);
  });

  it("leaves New project out while project edits are locked", () => {
    render(<ProjectsManager {...baseProps({ onEditProject: undefined })} />);

    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Search project name" })).toBeTruthy();
  });

  it("pages a long library 15 rows at a time, so the pages show on a laptop's first screen", () => {
    const many = Array.from({ length: 30 }, (_, index) => project({ id: "p" + index, name: "Work " + (index + 1) }));
    render(<ProjectsManager {...baseProps({ projects: many })} />);

    const table = screen.getByRole("region", { name: "Projects" });
    expect(within(table).getAllByRole("button", { name: /^Open Work/ })).toHaveLength(15);
    expect(screen.getByText("1–15 of 30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous page of projects" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Next page of projects" }));
    expect(within(table).getAllByRole("button", { name: /^Open Work/ })).toHaveLength(15);
    expect(screen.getByText("16–30 of 30")).toBeTruthy();
    expect(screen.getByText("Work 16")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next page of projects" })).toHaveProperty("disabled", true);
  });

  it("sorts by a column title and returns to the user's order on the third press", () => {
    const names = () => within(screen.getByRole("region", { name: "Projects" })).getAllByRole("button", { name: /^Open / }).map((button) => button.querySelector("strong")?.textContent);
    render(<ProjectsManager {...baseProps({
      projects: [project({ id: "a", name: "Beta" }), project({ id: "b", name: "Alpha" }), project({ id: "c", name: "Gamma" })],
      totalSecondsByProject: new Map([["a", 600], ["b", 3600], ["c", 60]]),
    })} />);

    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
    const time = screen.getByRole("button", { name: /Time · Latest 7 days/ });
    fireEvent.click(time);
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(time.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(time);
    expect(names()).toEqual(["Gamma", "Beta", "Alpha"]);
    fireEvent.click(time);
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(time.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /^Project/ }));
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("searches the whole library from the first page, and reaches archived projects", () => {
    const many = Array.from({ length: 30 }, (_, index) => project({ id: "p" + index, name: "Work " + (index + 1) }));
    render(<ProjectsManager {...baseProps({ projects: [...many, project({ id: "pa", name: "Blog relaunch", status: "archived", anchors: [] })] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Next page of projects" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search project name" }), { target: { value: "work 2" } });
    // Work 2 and Work 20–29, from both pages, on the first page of the results.
    expect(screen.getByText("1–11 of 11")).toBeTruthy();
    expect(screen.getByText("Work 2")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Search project name" }), { target: { value: "blog" } });
    expect(screen.queryByText("Work 1")).toBeNull();
    expect(screen.getByText("Blog relaunch")).toBeTruthy();
  });

  it("draws each project's seven-day trend beside its time", () => {
    render(<ProjectsManager {...baseProps({ dailySecondsByProject: new Map([["p1", [0, 600, 1200, 0, 3600, 1800, 900]]]) })} />);
    expect(screen.getByRole("img", { name: "Drifty, latest 7 days" })).toBeTruthy();
  });

  it("offers to refine the description when matching found nothing", () => {
    const props = baseProps({
      projects: [project({ id: "p3", name: "Idle", anchors: [] })],
      totalSecondsByProject: new Map(),
      lastActivityByProject: new Map(),
      autoAnalysis: { p3: "complete" },
    });
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Refine description" }));
    expect(props.onEditProject).toHaveBeenCalledWith(expect.objectContaining({ id: "p3" }));
    expect(props.onOpenProject).not.toHaveBeenCalled();
  });

  it("shows a dash and 0m for projects without activity in the window", () => {
    render(
      <ProjectsManager
        {...baseProps({
          projects: [project({ id: "p3", name: "Idle", anchors: [] })],
          totalSecondsByProject: new Map(),
          lastActivityByProject: new Map(),
        })}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("0m")).toBeTruthy();
  });

  it("shows a live matching state instead of a finished 0m for a project being analyzed", () => {
    render(
      <ProjectsManager
        {...baseProps({
          projects: [project({ id: "p3", name: "Idle", anchors: [] })],
          totalSecondsByProject: new Map(),
          lastActivityByProject: new Map(),
          autoAnalysis: { p3: "running" },
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Matching…");
    expect(screen.queryByText("0m")).toBeNull();
  });

  it("separates setup, failure, and analyzed-but-empty from an unanalyzed project", () => {
    const props = {
      projects: [project({ id: "p3", name: "Idle", anchors: [] })],
      totalSecondsByProject: new Map<string, number>(),
      lastActivityByProject: new Map<string, string>(),
    };
    const { rerender } = render(<ProjectsManager {...baseProps({ ...props, autoAnalysis: { p3: "waiting_for_model" } })} />);
    expect(screen.getByText("Setup needed")).toBeTruthy();

    rerender(<ProjectsManager {...baseProps({ ...props, autoAnalysis: { p3: "error" } })} />);
    expect(screen.getByText("Retry needed")).toBeTruthy();

    rerender(<ProjectsManager {...baseProps({ ...props, autoAnalysis: { p3: "queued" } })} />);
    expect(screen.getByText("Matching soon…")).toBeTruthy();
    expect(screen.queryByText("0m")).toBeNull();

    rerender(<ProjectsManager {...baseProps({ ...props, autoAnalysis: { p3: "complete" } })} />);
    expect(screen.getByText("No recent match")).toBeTruthy();
    expect(screen.queryByText("0m")).toBeNull();
  });

  it("leaves other projects' totals untouched while one project is matching", () => {
    render(
      <ProjectsManager
        {...baseProps({
          projects: [project(), project({ id: "p2", name: "New work", anchors: [] })],
          autoAnalysis: { p2: "running" },
        })}
      />,
    );
    expect(screen.getByText("5h 30m")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Matching…");
  });

  it("keeps an earlier project's pending state when a second project starts matching", () => {
    render(
      <ProjectsManager
        {...baseProps({
          projects: [project({ id: "p1", name: "First" }), project({ id: "p2", name: "Second", anchors: [] })],
          totalSecondsByProject: new Map(),
          lastActivityByProject: new Map(),
          autoAnalysis: { p1: "error", p2: "running" },
        })}
      />,
    );
    expect(screen.getByText("Retry needed")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Matching…");
    expect(screen.queryByText("0m")).toBeNull();
  });
});
