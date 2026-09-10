// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightsTabs } from "./InsightsTabs";

describe("InsightsTabs", () => {
  it("keeps the Your usage tab visible when it is the only section", () => {
    render(<InsightsTabs activeTab="usage" onChange={() => undefined} />);
    expect(screen.getByRole("tab", { name: "Your usage" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "Your read" })).toBeNull();
  });
});
