// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
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
    isLatestWindow: true,
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
  it("keeps the shared project options menu on screen through its exit", async () => {
    render(
      <LocalizationTestProvider language="en">
        <TeamProjectsView {...props()} projects={[{ ...project, can_manage: true }]} />
      </LocalizationTestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Options for Shared alpha" }));

    const menu = screen.getByRole("menu", { name: "Project options" });
    const boundary = menu.parentElement as HTMLElement;
    await waitFor(() => expect(boundary.getAttribute("data-anchored-presence")).toBe("open"));

    fireEvent.click(screen.getByRole("button", { name: "Options for Shared alpha" }));

    expect(boundary.getAttribute("data-anchored-presence")).toBe("exiting");
    expect(boundary.inert).toBe(true);
    expect(screen.queryByRole("menu", { name: "Project options" })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Project options" })).toBeNull());
  });

  it.each(["create", "row edit", "detail edit"])("focuses Name and restores the %s invoker", async (route) => {
    render(<TeamProjectsView {...props()} projects={[{ ...project, can_manage: true }]} />);
    let trigger: HTMLElement;
    if (route === "create") {
      trigger = screen.getByRole("button", { name: "New project" });
      fireEvent.click(trigger);
    } else if (route === "row edit") {
      trigger = screen.getByRole("button", { name: "Options for Shared alpha" });
      fireEvent.click(trigger);
      const edit = screen.getByRole("menuitem", { name: "Edit" });
      edit.focus();
      fireEvent.click(edit);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Open Shared alpha project" }));
      trigger = screen.getByRole("button", { name: "Edit" });
      fireEvent.click(trigger);
    }
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Name"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

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
      color: "#5366a3",
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

  it("localizes the shared-project controls while preserving user-authored content", () => {
    render(
      <LocalizationTestProvider language="ko">
        <TeamProjectsView {...props()} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", { name: "새 프로젝트" })).toBeTruthy();
    expect(screen.getByLabelText("프로젝트 이름 검색")).toBeTruthy();
    expect(screen.getByText("팀 시간 · 오늘")).toBeTruthy();
    expect(screen.getByText("Shared alpha")).toBeTruthy();
    expect(screen.getByText("Shared project")).toBeTruthy();
  });

  it("returns from a project's detail to the list when the Projects tab is pressed again", () => {
    const { rerender } = render(
      <LocalizationTestProvider language="en">
        <TeamProjectsView {...props()} />
      </LocalizationTestProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open shared alpha/i }));
    expect(screen.getByRole("button", { name: /all projects/i })).toBeTruthy();

    rerender(
      <LocalizationTestProvider language="en">
        <TeamProjectsView {...props()} listResetSignal={1} />
      </LocalizationTestProvider>,
    );
    expect(screen.queryByRole("button", { name: /all projects/i })).toBeNull();
    expect(screen.getByLabelText("Search project name")).toBeTruthy();
  });

  it("drops team time and the member split for a seat that may not see them, and keeps the project itself", () => {
    // Given: a project with time from two people.
    const shared: TeamProjectsViewProps = {
      ...props(),
      mix: [{ organization_id: "team-1", organization_project_id: project.id, project_name: project.name, project_color: project.color, project_status: "active", activity_date: "2026-07-14", seconds: 5400 }],
      members: [
        { organization_id: "team-1", organization_project_id: project.id, project_name: project.name, member_display_name: "Ada", member_key: "a", member_slot: 1, is_self: false, seconds: 3600 },
        { organization_id: "team-1", organization_project_id: project.id, project_name: project.name, member_display_name: "Ben", member_key: "b", member_slot: 2, is_self: false, seconds: 1800 },
      ],
    };
    const open = (extra: Partial<TeamProjectsViewProps>) => {
      const view = render(
        <LocalizationTestProvider language="en">
          <TeamProjectsView {...shared} {...extra} />
        </LocalizationTestProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: /open shared alpha/i }));
      return view;
    };

    // When: people are not shown to this seat.
    const noPeople = open({ memberSplitShown: false });

    // Then: team time stays, the contributor count and the split go.
    expect(screen.getByText(/^Team time/)).toBeTruthy();
    expect(screen.queryByText("Contributors")).toBeNull();
    expect(screen.queryByText(/^By member/)).toBeNull();
    expect(screen.queryByText("Ada")).toBeNull();
    noPeople.unmount();

    // When: no totals for this seat either.
    open({ totalsShown: false, memberSplitShown: false, mix: [], members: [] });

    // Then: the project's definition is all that is left.
    expect(screen.getByText("Shared project")).toBeTruthy();
    expect(screen.queryByText(/^Team time/)).toBeNull();
    expect(screen.queryByText(/^Shared time/)).toBeNull();
  });
});
