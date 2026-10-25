// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import type { TeamProjectShare } from "./teamFocusModel";
import { TEAM_DIAL_MAX_PROJECTS, TeamProjectRankPanel } from "./TeamMembersSections";

function shares(named: number): TeamProjectShare[] {
  const list: TeamProjectShare[] = Array.from({ length: named }, (_, index) => ({ projectId: "p" + index, name: "Project " + index, color: "#123456", seconds: (named - index) * 3600 }));
  return [...list, { projectId: null, name: null, color: null, seconds: 1800 }];
}

function renderPanel(named: number) {
  return render(
    <LocalizationTestProvider language="en">
      <TeamProjectRankPanel shares={shares(named)} language="en" />
    </LocalizationTestProvider>,
  );
}

describe("TeamProjectRankPanel", () => {
  it("names every project in the share dial up to five, unassigned as its own slice", () => {
    // When
    const { container } = renderPanel(TEAM_DIAL_MAX_PROJECTS);

    // Then
    expect(container.querySelector(".projects-share")).not.toBeNull();
    const labels = [...container.querySelectorAll(".projects-share__label")].map((node) => node.textContent);
    expect(labels).toEqual(["Project 0", "Project 1", "Project 2", "Project 3", "Project 4", "Unassigned"]);
  });

  it("switches to the ranked rows once a team has more projects than the dial names", () => {
    // When
    const { container } = renderPanel(TEAM_DIAL_MAX_PROJECTS + 1);

    // Then
    expect(container.querySelector(".projects-share")).toBeNull();
    expect(container.querySelectorAll(".team-sources__item").length).toBeGreaterThan(0);
  });

  it("pages the ranked rows five at a time, the same five the dial names", () => {
    const { container } = renderPanel(10);
    expect(container.querySelectorAll(".team-sources__item")).toHaveLength(TEAM_DIAL_MAX_PROJECTS);
    expect(container.querySelector(".insight-source-pager")?.textContent).toContain("1–5 / 11");
  });
});

