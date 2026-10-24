// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Your Day app usage alignment", () => {
  const component = readFileSync(new URL("./AppUsagePanel.tsx", import.meta.url), "utf8");
  // The loading panel lives beside the loaded one and must keep its markup.
  const skeleton = component.slice(component.indexOf("function AppUsagePanelLoading"));
  const styles = readFileSync(new URL("./dashboard.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

  function extractBody(bodyStart: number): { body: string; end: number } {
    let depth = 1;
    for (let index = bodyStart + 1; index < styles.length; index += 1) {
      if (styles[index] === "{") depth += 1;
      if (styles[index] === "}") depth -= 1;
      if (depth === 0) return { body: styles.slice(bodyStart + 1, index), end: index };
    }

    throw new Error("Missing closing brace in dashboard.css");
  }

  function normalizeSelector(selector: string): string {
    return selector.replace(/\s+/gu, " ").trim();
  }

  function blockBodies(header: string): string[] {
    const bodies: string[] = [];
    let searchStart = 0;

    while (searchStart < styles.length) {
      const headerStart = styles.indexOf(header, searchStart);
      if (headerStart === -1) break;

      let bodyStart = headerStart + header.length;
      while (/\s/u.test(styles[bodyStart] ?? "")) bodyStart += 1;
      if (styles[bodyStart] !== "{") {
        searchStart = headerStart + header.length;
        continue;
      }

      const { body, end } = extractBody(bodyStart);
      bodies.push(body);
      searchStart = end + 1;
    }

    if (bodies.length === 0) throw new Error(`Missing CSS block: ${header}`);
    return bodies;
  }

  function blockBody(header: string, requiredDeclaration?: RegExp): string {
    const body = blockBodies(header).find((candidate) => !requiredDeclaration || requiredDeclaration.test(candidate));
    if (!body) throw new Error(`Missing matching CSS block: ${header}`);
    return body;
  }

  function ruleBody(selectors: string[], requiredDeclaration?: RegExp): string {
    const expected = selectors.map(normalizeSelector).sort();
    const terminalSelector = selectors[selectors.length - 1];
    if (!terminalSelector) throw new Error("At least one selector is required");

    let searchStart = 0;
    while (searchStart < styles.length) {
      const selectorStart = styles.indexOf(terminalSelector, searchStart);
      if (selectorStart === -1) break;

      let bodyStart = selectorStart + terminalSelector.length;
      while (/\s/u.test(styles[bodyStart] ?? "")) bodyStart += 1;
      if (styles[bodyStart] !== "{") {
        searchStart = selectorStart + terminalSelector.length;
        continue;
      }

      const headerStart = Math.max(styles.lastIndexOf("}", selectorStart - 1), styles.lastIndexOf("{", selectorStart - 1)) + 1;
      const actual = styles.slice(headerStart, bodyStart).split(",").map(normalizeSelector).sort();
      const { body, end } = extractBody(bodyStart);
      if (actual.length === expected.length
        && actual.every((selector, index) => selector === expected[index])
        && (!requiredDeclaration || requiredDeclaration.test(body))) {
        return body;
      }

      searchStart = end + 1;
    }

    throw new Error(`Missing matching CSS rule: ${selectors.join(", ")}`);
  }

  it("keeps the existing feature card and secondary ranked-list composition", () => {
    expect(component).toContain('className="app-usage-feature"');
    expect(component).toContain("secondaryItems.map");
    expect(component).toContain("app-usage-panel--activity");
    expect(skeleton).toContain("app-usage-panel--activity");
    for (const className of [
      "app-usage-content",
      "app-usage-feature",
      "app-usage-feature__topline",
      "app-usage-feature__measure",
      "app-usage-feature__meter-block",
      "app-usage-feature__stats",
      "app-usage-list",
      "app-usage-row",
      "app-usage-row__main",
      "app-usage-row__bar",
      "app-usage-row__figures",
      "app-usage-panel--short-compact",
    ]) {
      expect(skeleton).toContain(className);
    }
  });

  it("shares rank, identity, bar, and figure tracks across secondary rows", () => {
    const panelBase = ruleBody([".app-usage-panel.editorial-panel"], /container-name:\s*app-usage-panel/u);
    const contentBase = ruleBody([".app-usage-content"], /display:\s*grid/u);
    const listBase = ruleBody([".app-usage-list"]);
    const rowBase = ruleBody([".app-usage-row"]);
    const activityList = ruleBody([":where(.app-usage-panel--activity) .app-usage-list"]);
    const activityRow = ruleBody([":where(.app-usage-panel--activity) .app-usage-row"]);

    expect(panelBase).toMatch(/container-type:\s*inline-size/u);
    expect(contentBase).toMatch(/display:\s*grid/u);
    expect(listBase).toMatch(/display:\s*grid/u);
    expect(listBase).toMatch(/container-type:\s*inline-size/u);
    expect(listBase).toMatch(/container-name:\s*app-usage-list/u);
    expect(rowBase).toMatch(/display:\s*grid/u);
    expect(activityList).toMatch(
      /grid-template-columns:\s*2\.7ch\s+minmax\(0,\s*1\.42fr\)\s+minmax\(3\.5rem,\s*0\.68fr\)\s+minmax\(0,\s*auto\)/u,
    );
    expect(activityRow).toMatch(/grid-column:\s*1\s*\/\s*-1/u);
    expect(activityRow).toMatch(/grid-template-columns:\s*subgrid/u);
  });

  it("clips the title wrapper at the identity track before it reaches the bar", () => {
    const copy = ruleBody([":where(.app-usage-panel--activity) .app-usage-row__copy"]);
    const title = ruleBody([":where(.app-usage-panel--activity) .app-usage-row__title"]);

    expect(copy).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
    expect(title).toMatch(/min-width:\s*0/u);
    expect(title).toMatch(/overflow:\s*hidden/u);
  });

  it("bounds duration and share copy inside the figures track", () => {
    const figures = ruleBody([
      ":where(.app-usage-panel--activity) .app-usage-row__bar",
      ":where(.app-usage-panel--activity) .app-usage-row__figures",
    ], /overflow:\s*hidden/u);
    const figureCopy = ruleBody([
      ":where(.app-usage-panel--activity) .app-usage-row__figures strong",
      ":where(.app-usage-panel--activity) .app-usage-row__figures span",
    ]);

    expect(figures).toMatch(/overflow:\s*hidden/u);
    expect(figureCopy).toMatch(/min-width:\s*0/u);
    expect(figureCopy).toMatch(/max-width:\s*100%/u);
    expect(figureCopy).toMatch(/overflow:\s*hidden/u);
    expect(figureCopy).toMatch(/text-overflow:\s*ellipsis/u);
    expect(figureCopy).toMatch(/white-space:\s*nowrap/u);
  });

  it("folds rows from their container width without a viewport-forced tall layout", () => {
    const listFold = blockBody("@container app-usage-list (max-width: 19rem)");
    const panelFold = blockBody("@container app-usage-panel (max-width: 32rem)");
    const viewportFallbacks = blockBodies("@media (max-width: 860px)");

    expect(listFold).toMatch(
      /:where\(\.app-usage-panel--activity\) \.app-usage-row\s*\{[^}]*grid-template-columns:\s*2\.35ch\s+minmax\(0,\s*1fr\)[^}]*height:\s*auto/u,
    );
    expect(panelFold).toMatch(
      /:where\(\.app-usage-panel--activity\) \.app-usage-content\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    );
    for (const viewportFallback of viewportFallbacks) {
      expect(viewportFallback).not.toContain("app-usage-panel--activity");
      expect(viewportFallback).not.toMatch(/\.app-usage-row\b/u);
    }
  });
});
