import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const popoverStyles = readFileSync("src/styles/popover-motion.css", "utf8");
const entry = readFileSync("src/main.tsx", "utf8");

/** Click-opened popups. Each renders through an AnchoredPresence boundary, so
   it is seen arriving and leaving; a new one added without a boundary would
   open with no motion at all, the way these surfaces used to. */
const boundaryOwnedPopups = [
  "account-popover",
  "settings-select-control__menu",
  "settings-search__results",
  "pt-menu",
  "team-switcher-menu",
  "developer-skill-picker__menu",
] as const;

/** Entry only, each for a stated reason rather than by omission. */
const entryOnlyPopups = [
  ".week-activity-inspector",
  ".week-activity-inspector__picker",
  ".week-activity-inspector--preview",
] as const;

function componentFiles(directory = "src/"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    if (item.isDirectory()) return componentFiles(`${directory}${item.name}/`);
    if (!item.name.endsWith(".tsx") || item.name.includes(".test.")) return [];
    return [`${directory}${item.name}`];
  });
}

describe("anchored popover motion", () => {
  it("is loaded by the app entry, so the rules reach the running window", () => {
    expect(entry).toContain('import "./styles/popover-motion.css";');
  });

  it("opens on the shared anchored easing and closes faster, the way modals do", () => {
    expect(popoverStyles).toContain("--popover-motion-duration: 160ms;");
    expect(popoverStyles).toContain("--popover-motion-ease: var(--ease-out-quart);");
    expect(popoverStyles).toMatch(/\[data-anchored-presence="exiting"\]\s*\{[^}]*--popover-motion-duration: 100ms;/);
    expect(popoverStyles).toMatch(/\[data-anchored-presence="exiting"\]\s*\{[^}]*--popover-motion-ease: cubic-bezier\(.4, 0, 1, 1\);/);
  });

  it("emerges from the anchor instead of zooming like a centred modal", () => {
    const keyframes = popoverStyles.match(/@keyframes popover-anchored-in\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(keyframes).toContain("opacity: 0;");
    expect(keyframes).toContain("transform: translate3d(0, -0.25rem, 0) scale(0.985);");
    expect(popoverStyles).toMatch(/\[data-anchored-presence="entering"\],\s*\[data-anchored-presence="exiting"\]\s*\{[^}]*translate3d\(0, -0.25rem, 0\) scale\(0.985\)/);
  });

  it("leaves no transform behind, so a panel never becomes a fixed-position containing block", () => {
    expect(popoverStyles).not.toContain("forwards");
    expect(popoverStyles).toContain("--popover-motion-transform: none;");
    expect(popoverStyles).toContain("animation: popover-anchored-in 160ms var(--ease-out-quart) backwards;");
  });

  it("routes every click-opened popup through a presence boundary", () => {
    for (const popup of boundaryOwnedPopups) {
      // Whole class token only, so pt-menu-slot is not read as pt-menu, and
      // className lines only, so an outside-click selector is not markup.
      const token = new RegExp(`(?<![\\w-])${popup}(?![\\w-])`);
      const renderSites = (source: string) => {
        const sites: number[] = [];
        let offset = 0;
        for (const line of source.split("\n")) {
          // The index inside the line matters: a portal can open its boundary
          // and render the panel on one line.
          if (line.includes("className") && token.test(line)) sites.push(offset + line.search(token));
          offset += line.length + 1;
        }
        return sites;
      };
      const owners = componentFiles().filter((file) => renderSites(readFileSync(file, "utf8")).length > 0);

      expect(owners.length, `.${popup} should be rendered somewhere`).toBeGreaterThan(0);
      for (const owner of owners) {
        const source = readFileSync(owner, "utf8");
        // Mentioning the boundary is not enough: the markup has to sit inside
        // one. A boundary that the popup escapes is what left the plan dialog
        // motionless while its call site looked correct.
        const boundaries = [...source.matchAll(/<AnchoredPresence>/g)].map((match) => ({
          from: match.index ?? 0,
          to: source.indexOf("</AnchoredPresence>", match.index ?? 0),
        }));
        for (const at of renderSites(source)) {
          expect(
            boundaries.some((region) => at > region.from && at < region.to),
            `${owner} renders .${popup} outside any AnchoredPresence boundary`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the week inspector family entry-only until it owns its own boundary", () => {
    const declarations = popoverStyles.split("animation: popover-anchored-in")[0].split("\n\n");
    const entryOnlyRule = declarations[declarations.length - 1] ?? "";

    for (const surface of entryOnlyPopups) {
      expect(entryOnlyRule, `${surface} stays entry-only on purpose`).toContain(surface);
    }
  });

  it("drops the entry animation when reduced motion is requested", () => {
    const reduced = popoverStyles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}/)?.[1] ?? "";

    expect(reduced).toContain("[data-anchored-presence] > *");
    for (const surface of entryOnlyPopups) {
      expect(reduced, `${surface} should opt out under reduced motion`).toContain(surface);
    }
    expect(reduced).toContain("animation: none !important;");
    expect(reduced).toContain("transition: none !important;");
  });
});
