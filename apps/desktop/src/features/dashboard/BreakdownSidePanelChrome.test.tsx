// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readAppStyles } from "../../test/readStyles";
import { BreakdownSidePanel } from "./BreakdownSidePanelChrome";

function cssRule(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? "";
}

describe("BreakdownSidePanel chrome", () => {
  it("keeps both restrained chevron shells in both panel directions", () => {
    const { rerender } = render(
      <BreakdownSidePanel open={false} onToggle={vi.fn()} ariaLabel="Day breakdown" toggleSubject="day breakdown">
        <div>Panel contents</div>
      </BreakdownSidePanel>,
    );

    const expandButton = screen.getByRole("button", { name: "Show day breakdown" });
    expect(
      [...expandButton.querySelectorAll('[data-direction="left"] path')].map((path) => path.getAttribute("d")),
    ).toEqual([
      "M3 4.5 7 8 3 11.5",
      "M8.5 4.5 12.5 8 8.5 11.5",
    ]);

    rerender(
      <BreakdownSidePanel open onToggle={vi.fn()} ariaLabel="Day breakdown" toggleSubject="day breakdown">
        <div>Panel contents</div>
      </BreakdownSidePanel>,
    );

    const collapseButton = screen.getByRole("button", { name: "Collapse day breakdown" });
    expect(
      [...collapseButton.querySelectorAll('[data-direction="right"] path')].map((path) => path.getAttribute("d")),
    ).toEqual([
      "M3 4.5 7 8 3 11.5",
      "M8.5 4.5 12.5 8 8.5 11.5",
    ]);
  });

  it("keeps the shared Breakdown title subtly smaller and softer", () => {
    const styles = readAppStyles();
    const rootRule = cssRule(styles, ":root");
    const iconRule = cssRule(styles, ".week-v2-side__chevron");
    const titleRule = cssRule(styles, ".week-v2-side__title");

    expect(rootRule).toContain("--type-breakdown-title-size: 0.714rem;");
    expect(rootRule).toContain("--text-breakdown-title: color-mix(in srgb, var(--text) 86%, var(--text-soft));");
    expect(titleRule).toContain("font-size: var(--type-breakdown-title-size);");
    expect(titleRule).toContain("color: var(--text-breakdown-title);");
    expect(titleRule).not.toMatch(/font-size:\s*[\d.]+px/);
    expect(iconRule).toContain("stroke-width: 1.5;");
  });
});
