// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    autoAnalysis: IDLE_PROJECT_AUTO_ANALYSIS,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onOpenProject: vi.fn(),
    ...overrides,
  };
}

describe("ProjectsManager", () => {
  it("waits for project loading before consuming a creation request", async () => {
    const onCreateRequestHandled = vi.fn();
    const props = baseProps({ createRequested: true, onCreateRequestHandled });
    const { rerender } = render(<ProjectsManager {...props} busy />);
    expect(screen.queryByRole("dialog", { name: "New project" })).toBeNull();
    expect(onCreateRequestHandled).not.toHaveBeenCalled();

    rerender(<ProjectsManager {...props} busy={false} />);
    expect(await screen.findByRole("dialog", { name: "New project" })).toBeTruthy();
    expect(onCreateRequestHandled).toHaveBeenCalledOnce();
  });

  it("keeps the row options menu on screen through its exit and takes it out of reach while it fades", async () => {
    render(<ProjectsManager {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));

    const menu = screen.getByRole("menu", { name: "Project options" });
    const boundary = menu.parentElement as HTMLElement;
    await waitFor(() => expect(boundary.getAttribute("data-anchored-presence")).toBe("open"));

    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));

    expect(boundary.getAttribute("data-anchored-presence")).toBe("exiting");
    expect(boundary.inert).toBe(true);
    expect(screen.queryByRole("menu", { name: "Project options" })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Project options" })).toBeNull());
  });

  it("keeps initial focus on Name after the modal has entered", async () => {
    render(<ProjectsManager {...baseProps()} />);
    const trigger = screen.getByRole("button", { name: "New project" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Name"));
    const close = within(dialog).getByRole("button", { name: "Close project editor" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it.each(["Escape", "Cancel", "Save"])("restores New project focus after %s", async (action) => {
    render(<ProjectsManager {...baseProps({ onSave: vi.fn(async () => true) })} />);
    const trigger = screen.getByRole("button", { name: "New project" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else if (action === "Cancel") fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    else {
      fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "QA project" } });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Create project" })); });
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it.each(["Escape", "Cancel", "Save"])("restores the persistent row trigger after Edit %s", async (action) => {
    render(<ProjectsManager {...baseProps({ onSave: vi.fn(async () => true) })} />);
    const trigger = screen.getByRole("button", { name: "Options for Drifty" });
    trigger.focus();
    fireEvent.click(trigger);
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    edit.focus();
    fireEvent.click(edit);
    const dialog = screen.getByRole("dialog", { name: "Edit project" });
    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    expect(edit.isConnected).toBe(false);
    if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: action === "Save" ? "Save changes" : "Cancel" })); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("renders a labeled project list with the fixed seven-day activity window", () => {
    render(<ProjectsManager {...baseProps()} />);

    const projectList = screen.getByRole("region", { name: "Projects" });
    expect(within(projectList).getByText("Last activity")).toBeTruthy();
    expect(within(projectList).getByText("Time · Latest 7 days")).toBeTruthy();
    expect(within(projectList).queryAllByText("Latest 7 days")).toHaveLength(0);
    expect(within(projectList).getByText("Drifty")).toBeTruthy();
    expect(within(projectList).getByText("Jul 10, 2026")).toBeTruthy();
    expect(within(projectList).getByText("Active")).toBeTruthy();
    expect(within(projectList).getByText("5h 30m")).toBeTruthy();
    expect(within(projectList).queryByText(/signals?$/i)).toBeNull();
  });

  it("reserves the status chip for archived projects so Active does not repeat the loudest treatment", () => {
    render(<ProjectsManager {...baseProps({
      projects: [project(), project({ id: "p2", name: "Blog relaunch", status: "archived", anchors: [] })],
    })} />);

    const projectList = screen.getByRole("region", { name: "Projects" });
    expect(within(projectList).getByText("Active").className).not.toContain("chip");
    expect(within(projectList).getByText("Archived").className).toContain("chip");
  });

  it("opens the project detail on row click instead of expanding", () => {
    const props = baseProps();
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByText("Drifty"));
    expect(props.onOpenProject).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("group", { name: "Details for Drifty" })).toBeNull();
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

  it("opens the row menu and edits the project through the modal", () => {
    const props = baseProps();
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));
    expect(props.onOpenProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

    const dialog = screen.getByRole("dialog", { name: "Edit project" });
    const nameInput = within(dialog).getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Drifty");

    fireEvent.change(nameInput, { target: { value: "Drifty Mac" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", name: "Drifty Mac", status: "active" }));
  });

  it("archives and deletes from the row menu", () => {
    const props = baseProps();
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", status: "archived" }));

    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    // Deleting asks first: nothing is removed until the confirmation's button.
    expect(props.onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete “Drifty”?" });
    expect(within(dialog).getByText("Latest 7 days: 5h 30m matched to this project")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));
    expect(props.onDelete).toHaveBeenCalledWith("p1");
  });

  it("keeps the delete confirmation open with a translated line when deletion fails", async () => {
    const onDelete = vi.fn().mockResolvedValueOnce({ deleted: false, error: "database is locked" }).mockResolvedValueOnce(true);
    render(<ProjectsManager {...baseProps({ onDelete })} />);

    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Drifty”?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Could not delete the project. Try again.");
    expect(alert.getAttribute("title")).toBe("database is locked");
    expect(screen.getByRole("dialog", { name: "Delete “Drifty”?" })).toBe(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  });

  it("offers Archive in the delete confirmation for an active project only", () => {
    const props = baseProps({
      projects: [project(), project({ id: "p2", name: "Blog relaunch", status: "archived", anchors: [] })],
    });
    render(<ProjectsManager {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Options for Drifty" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", status: "archived" }));
    expect(props.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Options for Blog relaunch" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const archivedDialog = screen.getByRole("dialog", { name: "Delete “Blog relaunch”?" });
    expect(within(archivedDialog).queryByRole("button", { name: "Archive instead" })).toBeNull();
    fireEvent.click(within(archivedDialog).getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("filters rows by search query and status", () => {
    const props = baseProps({
      projects: [project(), project({ id: "p2", name: "Blog relaunch", status: "archived", anchors: [] })],
    });
    render(<ProjectsManager {...props} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search project name" }), { target: { value: "blog" } });
    expect(screen.queryByText("Drifty")).toBeNull();
    expect(screen.getByText("Blog relaunch")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Search project name" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Filter by status" }));
    fireEvent.click(screen.getByRole("option", { name: "Active" }));
    expect(screen.getByText("Drifty")).toBeTruthy();
    expect(screen.queryByText("Blog relaunch")).toBeNull();
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
