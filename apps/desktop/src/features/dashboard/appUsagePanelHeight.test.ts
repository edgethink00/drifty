// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";

/**
 * Regression cover for the "Most used" card growing a large empty gap.
 *
 * The card and the ranked list sit in one grid row. The list decides whether to
 * fold its rows from its OWN inline size (a container query), while the split
 * itself used to fold only at a 860px window media query. Between those two
 * thresholds the list folded to tall two-line rows and the card, pinned with
 * `min-height: 100%`, stretched to match — pushing Share and the stat footer
 * apart. Worse, the stretched height fed back into the container query, so
 * widening the window again left the tall card until the panel was remounted
 * (switching tabs and returning), which is exactly what users reported.
 *
 * These assertions lock the three properties that keep that loop closed.
 */
describe("app usage panel height coupling", () => {
  // Strip comments first: these assertions are about declarations, and the
  // rules below deliberately mention the old value in prose.
  const styles = readAppStyles().replace(/\/\*[\s\S]*?\*\//gu, "");

  function ruleBodies(selector: string): string[] {
    const bodies: string[] = [];
    let cursor = 0;
    while (cursor < styles.length) {
      const at = styles.indexOf(selector, cursor);
      if (at === -1) break;
      cursor = at + selector.length;
      // Only accept the selector when it starts a declaration block, so a
      // longer selector that merely contains this one is not counted.
      const before = styles.slice(Math.max(0, at - 1), at);
      if (before && !/[\s,{}]/u.test(before)) continue;
      const rest = styles.slice(cursor);
      const open = rest.match(/^\s*\{/u);
      if (!open) continue;
      const bodyStart = cursor + open[0].length;
      const close = styles.indexOf("}", bodyStart);
      if (close === -1) break;
      bodies.push(styles.slice(bodyStart, close));
      cursor = close + 1;
    }
    return bodies;
  }

  it("never pins the feature card to a percentage of its grid track", () => {
    // A percentage min-height resolves against a track the sibling list sizes,
    // which is the feedback edge that made a stale folded height survive.
    for (const body of ruleBodies(".app-usage-feature")) {
      expect(body).not.toMatch(/min-height:\s*100%/u);
    }
  });

  it("still gives the card a fixed floor so a quiet day keeps its shape", () => {
    // Removing the percentage floor outright shrank the card on days with only
    // one or two ranked rows. The floor has to stay, just not as a percentage
    // of the neighbouring list.
    const featureBodies = ruleBodies(".app-usage-feature").join("\n");
    expect(featureBodies).toMatch(/min-height:\s*[\d.]+rem/u);
  });

  it("folds the split from the panel's own width, not only the window's", () => {
    // Without this the split stays two-column while the list is already folding.
    expect(styles).toMatch(
      /@container app-usage-panel \(max-width: [^)]+\)\s*\{[\s\S]*?\.app-usage-content\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u,
    );
  });

  it("declares the panel as the container the fold measures", () => {
    const panelBodies = ruleBodies(".app-usage-panel.editorial-panel").join("\n");
    expect(panelBodies).toMatch(/container-type:\s*inline-size/u);
    expect(panelBodies).toMatch(/container-name:\s*app-usage-panel/u);
  });

  it("lets the card's rows grow so Share keeps its space above the stat footer", () => {
    // The meter block and the stat footer both end-align inside their own row,
    // so the breathing room under the Share bar comes from those rows growing
    // past their content — not from the row gap. Pinning the rows to content
    // height closed that space to ~1px and the bar sat on the footer border.
    const featureBodies = ruleBodies(".app-usage-feature").join("\n");
    expect(featureBodies).toMatch(/align-content:\s*stretch/u);
    expect(featureBodies).not.toMatch(/align-content:\s*(?:start|space-between)/u);
  });
});
