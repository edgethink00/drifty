// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@drifty/domain";

import { ProjectsSettingsSection, type ProjectsSettingsSectionProps } from "./ProjectsSettingsSection";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Website redesign",
    description: "Redesigning the marketing site",
    color: "#6366f1",
    status: "active",
    anchors: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderSection(overrides: Partial<ProjectsSettingsSectionProps> = {}) {
  const props: ProjectsSettingsSectionProps = {
    projects: [],
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onAddAnchor: vi.fn(),
    onDeleteAnchor: vi.fn(),
    ...overrides,
  };
  render(<ProjectsSettingsSection {...props} />);
  return props;
}

describe("ProjectsSettingsSection", () => {
  it("lists existing project names and descriptions", () => {
    renderSection({
      projects: [
        makeProject({ id: "p1", name: "Website redesign", description: "Redesigning the marketing site" }),
        makeProject({ id: "p2", name: "Tax filing", description: "Quarterly bookkeeping and taxes" }),
      ],
    });

    expect(screen.getByText("Website redesign")).toBeTruthy();
    expect(screen.getByText("Redesigning the marketing site")).toBeTruthy();
    expect(screen.getByText("Tax filing")).toBeTruthy();
    expect(screen.getByText("Quarterly bookkeeping and taxes")).toBeTruthy();
  });

  it("submits the create form with the entered name and description", () => {
    const props = renderSection();

    // The editor is an on-demand modal now; open it first.
    fireEvent.click(screen.getByRole("button", { name: /New project/i }));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Website redesign" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Everything for the marketing site refresh" } });
    fireEvent.click(screen.getByRole("button", { name: /Create project/i }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Website redesign", description: "Everything for the marketing site refresh" }),
    );
  });

  it("deletes a project by id", () => {
    const props = renderSection({ projects: [makeProject({ id: "p1" })] });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(props.onDelete).toHaveBeenCalledWith("p1");
  });

  it("reveals anchors under Advanced and removes a chip", () => {
    const props = renderSection({
      projects: [
        makeProject({
          id: "p1",
          anchors: [
            { kind: "domain", value: "figma.com", source: "harvested" },
            { kind: "app", value: "Xcode", source: "manual" },
          ],
        }),
      ],
    });

    expect(screen.queryByText("figma.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));

    expect(screen.getByText("figma.com")).toBeTruthy();
    expect(screen.getByText("Xcode")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Remove .*figma\.com/i }));

    expect(props.onDeleteAnchor).toHaveBeenCalledWith("p1", "domain", "figma.com");
  });

  it("adds an anchor from the Advanced control", () => {
    const props = renderSection({ projects: [makeProject({ id: "p1", anchors: [] })] });

    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    fireEvent.change(screen.getByLabelText(/New signal type/i), { target: { value: "domain" } });
    fireEvent.change(screen.getByLabelText(/New signal value/i), { target: { value: "linear.app" } });
    fireEvent.click(screen.getByRole("button", { name: /Add signal/i }));

    expect(props.onAddAnchor).toHaveBeenCalledWith("p1", "domain", "linear.app");
  });

  it("keeps the editor in a modal that opens from New project and closes on Cancel", () => {
    renderSection({ projects: [makeProject({ id: "p1" })] });

    // Editor form is not mounted until requested.
    expect(screen.queryByLabelText("Project name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /New project/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Project name")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Project name")).toBeNull();
  });

  it("always offers a New project card, even with no projects", () => {
    renderSection({ projects: [] });

    expect(screen.getByRole("button", { name: /New project/i })).toBeTruthy();
  });
});
