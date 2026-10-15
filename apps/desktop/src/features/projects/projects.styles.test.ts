import { describe, expect, it } from "vitest";

import { readCssWithImports } from "../../test/readStyles";

const projectsStyles = readCssWithImports("src/features/projects/projects.css");

describe("project table styles", () => {
  it("lays the table out as a five-column grid (project, last activity, trend, total, pencil)", () => {
    const tableRule = projectsStyles.match(
      /\.projects-page \.projects-table__head,\s*\.projects-page \.projects-table__row\s*{(?<body>[\s\S]*?)}/,
    );
    const gridTemplate = tableRule?.groups?.body.match(/grid-template-columns:\s*([^;]+);/)?.[1].trim() ?? "";
    const columnCount = gridTemplate.split(/\s+(?![^(]*\))/).filter(Boolean).length;

    expect(columnCount).toBe(5);
  });
});
