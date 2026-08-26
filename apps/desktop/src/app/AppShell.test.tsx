// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MainContentShell, NavIcon } from "./AppShell";

describe("MainContentShell", () => {
  it("announces tracker errors when they appear", () => {
    render(
      <MainContentShell
        activeTab="dashboard"
        loading={false}
        hasLoadedOnce
        error="Tracker connection failed"
      >
        <p>Dashboard content</p>
      </MainContentShell>,
    );

    expect(screen.getByRole("alert").textContent).toBe("Error: Tracker connection failed");
  });
});

describe("NavIcon", () => {
  it("keeps the Projects layers on the same optical midline as nearby activity icons", () => {
    const { container } = render(<NavIcon type="projects" />);
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("expected projects svg");
    const paths = Array.from(svg.querySelectorAll("path")).map((path) => path.getAttribute("d"));

    expect(paths).toEqual([
      "M12 5 3 10l9 5 9-5-9-5Z",
      "M3 15l9 5 9-5",
      "M3 10v5m18-5v5",
    ]);
    expect(paths.join(" ")).not.toContain("M12 3");
  });
});
