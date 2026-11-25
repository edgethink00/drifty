// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightsTabs } from "./InsightsTabs";

describe("InsightsTabs", () => {
  it("shows Your usage and Achievements while Your read stays hidden", () => {
    render(<InsightsTabs activeTab="usage" onChange={() => undefined} />);
    expect(screen.getByRole("tab", { name: "Your usage" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Achievements" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("tab", { name: "Your read" })).toBeNull();
  });

  it("marks Achievements while it holds achievements not shown yet, until it is open", () => {
    const { rerender } = render(<InsightsTabs activeTab="usage" onChange={() => undefined} hasNewAchievements />);
    expect(screen.getByRole("tab", { name: "Achievements New achievements" })).toBeTruthy();
    rerender(<InsightsTabs activeTab="achievements" onChange={() => undefined} hasNewAchievements />);
    expect(screen.getByRole("tab", { name: "Achievements" })).toBeTruthy();
  });
});
