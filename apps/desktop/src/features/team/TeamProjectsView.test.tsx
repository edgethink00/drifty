// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamProjectsView, type TeamProjectsViewProps } from "./TeamProjectsView";
import type { TeamProject } from "./teamTypes";

const project: TeamProject = {
  id: "project-1",
  organization_id: "team-1",
  name: "Shared alpha",
  description: "Shared project",
  color: "#6366f1",
  status: "active",
  anchors: [],
  can_manage: false,
  created_at: "2026-07-14T00:00:00Z",
  updated_at: "2026-07-14T00:00:00Z",
};

function props(): TeamProjectsViewProps {
  return {
    teamName: "Alpha",
    projects: [project],
    mix: [],
    members: [],
    memberDisplayName: "Alex",
    window: { start_date: "2026-07-14", end_date: "2026-07-14" },
    loading: false,
    error: null,
    actionError: null,
    actionLoading: false,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onArchive: vi.fn(),
  };
}

describe("TeamProjectsView", () => {
  it("exposes a read-only shared project as a native primary action", () => {
    render(<TeamProjectsView {...props()} />);

    expect(screen.queryByRole("button", { name: "Options for Shared alpha" })).toBeNull();
    const openProject = screen.getByRole("button", { name: "Open Shared alpha project" });
    openProject.focus();
    expect(document.activeElement).toBe(openProject);
    fireEvent.click(openProject);
    expect(screen.getByRole("region", { name: "Shared project Shared alpha" })).toBeTruthy();
  });

  it("creates a shared project through the common project editor fields", () => {
    const viewProps = props();
    render(<TeamProjectsView {...viewProps} />);

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New shared project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Ship the launch." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(viewProps.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Launch",
      description: "Ship the launch.",
      color: "#6366f1",
    }));
  });

  it("dismisses an open shared-project menu with Escape", () => {
    const manageableProject = { ...project, can_manage: true };
    render(<TeamProjectsView {...props()} projects={[manageableProject]} />);

    fireEvent.click(screen.getByRole("button", { name: "Options for Shared alpha" }));
    expect(screen.getByRole("menu", { name: "Project options" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Project options" })).toBeNull();
  });
});
