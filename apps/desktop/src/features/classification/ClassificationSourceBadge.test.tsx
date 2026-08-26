// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";
import { ClassificationSourceBadge } from "./ClassificationSourceBadge";

const styles = readAppStyles();

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("ClassificationSourceBadge", () => {
  it("matches the neighboring hover identity-chip geometry", () => {
    const rule = cssRule("span.hover-metadata-chip");
    const sourceRule = cssRule("span.hover-metadata-chip.classification-source-badge");

    expect(rule).toContain("width: fit-content;");
    expect(rule).toContain("margin: 0;");
    expect(rule).toContain("padding: 0.19rem 0.44rem;");
    expect(rule).toContain("border: 1px solid color-mix(in srgb, var(--line-strong) 58%, transparent);");
    expect(rule).toContain("font-size: 0.7rem;");
    expect(rule).toContain("font-weight: 600;");
    expect(sourceRule).toContain("color: var(--text-muted);");
  });

  it("treats an LLM source as AI even when the explicit boolean is absent", () => {
    render(<ClassificationSourceBadge source="llm" />);

    const badge = screen.getByText("AI");
    expect(badge.getAttribute("aria-label")).toBe("Classification source: AI");
    expect(badge.classList.contains("hover-metadata-chip")).toBe(true);
    expect(badge.classList.contains("classification-source-badge--ai")).toBe(true);
  });

  it("keeps cached LLM provenance labeled and accented as AI", () => {
    render(<ClassificationSourceBadge source="llm" aiCached />);

    const badge = screen.getByText("AI cache");
    expect(badge.getAttribute("aria-label")).toBe("Classification source: AI cache");
    expect(badge.classList.contains("classification-source-badge--ai")).toBe(true);
  });

  it("keeps predefined provenance visually compact without losing its accessible meaning", () => {
    render(<ClassificationSourceBadge source="domain-db" />);

    const badge = screen.getByText("Predefined");
    expect(badge.getAttribute("aria-label")).toBe("Classification source: Predefined");
    expect(badge.classList.contains("classification-source-badge--ai")).toBe(false);
  });
});
