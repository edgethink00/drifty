// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("uses the caller-specific title as the single emphasized title", () => {
    const { container } = render(
      <EmptyState title="No weekly trend yet" detail="Weekly totals appear after activity is recorded." />,
    );

    expect(screen.getByText("No weekly trend yet").tagName).toBe("STRONG");
    expect(screen.queryByText("Not enough data yet")).toBeNull();
    expect(container.querySelector(".empty-state .eyebrow")).toBeNull();
  });
});
