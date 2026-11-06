// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamMemberWorkTitles } from "./TeamMemberWorkTitles";

const projects = [{ id: "p1", organization_id: "t", name: "Launch", description: "", color: "#a65b3e", status: "active" as const, anchors: [], can_manage: true, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" }];

describe("a person's work titles", () => {
  it("lists names by day with their time, and tells the person how to correct one", () => {
    const { rerender } = render(<LocalizationTestProvider language="en"><TeamMemberWorkTitles days={[{ day: "2026-11-05", items: [{ title: "Pricing page copy", seconds: 5400, projectId: "p1" }] }]} projects={projects} self={false} /></LocalizationTestProvider>);
    expect(screen.getByText("Work titles")).toBeTruthy();
    expect(screen.getByText("Pricing page copy")).toBeTruthy();
    expect(screen.getByText("1h 30m")).toBeTruthy();
    expect(screen.queryByText(/rename the block/)).toBeNull();
    rerender(<LocalizationTestProvider language="en"><TeamMemberWorkTitles days={[]} projects={projects} self /></LocalizationTestProvider>);
    expect(screen.getByText("No work titles in this period yet.")).toBeTruthy();
    expect(screen.getByText(/rename the block in Your Day/)).toBeTruthy();
  });
});
