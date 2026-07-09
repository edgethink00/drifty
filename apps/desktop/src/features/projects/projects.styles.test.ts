import { describe, expect, it } from "vitest";

import { readCssWithImports } from "../../test/readStyles";

const projectsStyles = readCssWithImports("src/features/projects/projects.css");

describe("project library grid styles", () => {
  it("keeps four project tiles in the first desktop row before wrapping", () => {
    const wideDesktopRule = projectsStyles.match(
      /@media\s*\(min-width:\s*(?<breakpoint>\d+)px\)\s*{[\s\S]*?\.projects-list__items\s*{(?<body>[\s\S]*?)}/,
    );
    const desktopBreakpoint = Number(wideDesktopRule?.groups?.breakpoint ?? 0);
    const gridTemplate = wideDesktopRule?.groups?.body.match(/grid-template-columns:\s*([^;]+);/)?.[1].trim() ?? "";
    const desktopColumnCount = Number(gridTemplate.match(/^repeat\((\d+),/)?.[1] ?? 0);

    expect(desktopBreakpoint).toBeGreaterThanOrEqual(1024);
    expect(desktopColumnCount).toBe(4);
  });
});
