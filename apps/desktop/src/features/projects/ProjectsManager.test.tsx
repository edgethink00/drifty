// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@drifty/domain";

import { ProjectsManager, type ProjectsManagerProps } from "./ProjectsManager";

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
    totalCaption: "Last 14 days",
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onOpenProject: vi.fn(),
    ...overrides,
  };
}

describe("ProjectsManager", () => {
  it("renders a table row with last activity, status, and windowed total (no signals column)", () => {
    render(<ProjectsManager {...baseProps()} />);

    const table = screen.getByRole("table", { name: "Projects" });
    expect(within(table).getByText("Drifty")).toBeTruthy();
    expect(within(table).getByText("Jul 10, 2026")).toBeTruthy();
    expect(within(table).getByText("Active")).toBeTruthy();
    expect(within(table).getByText("Last 14 days")).toBeTruthy();
    expect(within(table).getByText("5h 30m")).toBeTruthy();
    expect(within(table).queryByText(/signals?$/i)).toBeNull();
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
    const nameInput = within(dialog).getByLabelText("Project name") as HTMLInputElement;
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
    expect(props.onDelete).toHaveBeenCalledWith("p1");
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
});
