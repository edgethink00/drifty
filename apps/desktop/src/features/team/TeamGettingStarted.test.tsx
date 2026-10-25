// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamGettingStarted } from "./TeamGettingStarted";

function view(projectCount: number) {
  const onInvite = vi.fn();
  const onProjects = vi.fn();
  render(<LocalizationTestProvider language="en"><TeamGettingStarted projectCount={projectCount} onInvite={onInvite} onProjects={onProjects} /></LocalizationTestProvider>);
  return { onInvite, onProjects };
}

describe("a new team's first screen", () => {
  it("names the two steps that start a team, each with its action", () => {
    const { onInvite, onProjects } = view(0);
    expect(screen.getByText("Getting started")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onProjects).toHaveBeenCalledTimes(1);
  });

  it("marks the projects step done once the team has one", () => {
    view(2);
    expect(screen.getByText("2 made")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View projects" })).toBeTruthy();
    expect(document.querySelector(".team-start__step.is-done")).not.toBeNull();
  });
});

