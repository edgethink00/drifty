import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseStyles = readFileSync("src/styles.css", "utf8");
const motionStyles = readFileSync("src/features/chartHoverMotion.css", "utf8");

function cssRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("chart hover motion", () => {
  it("defines the chart motion easing token used by hover contracts", () => {
    const rootRule = cssRule(motionStyles, ":root");

    expect(rootRule).toContain("--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);");
    expect(baseStyles).not.toContain("--ease-out-quart");
  });

  it("keeps flow grid cells stable while the inner overlay breathes on hover", () => {
    const flowCellRule = cssRule(motionStyles, ".flow-cell");
    const flowCellHoverRule = motionStyles.match(/button\.flow-cell:hover,\s*button\.flow-cell:focus\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const flowCellGroupRule = cssRule(motionStyles, "button.flow-cell.flow-cell--hover-group");
    const flowHoverGroupHighlightRule = cssRule(motionStyles, ".flow-hover-group-highlight");
    const flowMarkRule = cssRule(motionStyles, ".flow-cell__mark");
    const flowMarkGroupRule = cssRule(motionStyles, ".flow-cell--hover-group .flow-cell__mark");
    const flowMarkHoverRule = motionStyles.match(/button\.flow-cell:hover \.flow-cell__mark,\s*button\.flow-cell:focus \.flow-cell__mark\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const flowMarkGroupHoverRule = motionStyles.match(/button\.flow-cell\.flow-cell--hover-group:hover \.flow-cell__mark,\s*button\.flow-cell\.flow-cell--hover-group:focus \.flow-cell__mark\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(flowCellRule).toContain("transition: box-shadow 160ms var(--ease-out-quart), filter 160ms var(--ease-out-quart);");
    expect(flowCellHoverRule).toContain("transform: none;");
    expect(flowCellGroupRule).toContain("filter: none;");
    expect(flowCellGroupRule).toContain("box-shadow: none;");
    expect(flowHoverGroupHighlightRule).toContain("position: absolute;");
    expect(flowHoverGroupHighlightRule).toContain("height: calc((100% / var(--flow-row-count)) * var(--flow-hover-row-span));");
    expect(flowHoverGroupHighlightRule).toContain("background: color-mix(in srgb, var(--surface) 26%, transparent);");
    expect(flowHoverGroupHighlightRule).toContain("animation: flow-hover-group-in 160ms var(--ease-out-quart) both;");
    expect(flowMarkRule).toContain("transition: opacity 160ms var(--ease-out-quart), background 160ms var(--ease-out-quart), box-shadow 160ms var(--ease-out-quart);");
    expect(flowMarkGroupRule).toContain("opacity: 0;");
    expect(flowMarkGroupRule).toContain("box-shadow: none;");
    expect(flowMarkHoverRule).toContain("opacity: 0.5;");
    expect(flowMarkHoverRule).toContain("transform: none;");
    expect(flowMarkGroupHoverRule).toContain("opacity: 0;");
  });

  it("animates compact donut and stacked bar hovers with graph-specific feedback", () => {
    const donutRule = cssRule(motionStyles, ".flow-compact-productivity-circle__segment");
    const donutHoverRule = cssRule(motionStyles, ".flow-compact-productivity-circle__segment:hover");
    const reviewDonutRule = cssRule(motionStyles, ".eodr-dial__segment");
    const reviewDonutHoverRule = cssRule(motionStyles, ".eodr-dial__segment:hover");
    const barRule = cssRule(motionStyles, ".flow-compact-split-chart__segment");
    const barHoverRule = cssRule(motionStyles, ".flow-compact-split-chart__segment:hover");

    expect(donutRule).toContain("transition: filter 180ms var(--ease-out-quart), stroke-width 180ms var(--ease-out-quart), opacity 180ms var(--ease-out-quart);");
    expect(donutHoverRule).toContain("filter: brightness(1.08) saturate(1.05);");
    expect(donutHoverRule).toContain("stroke-width: 19;");
    expect(motionStyles).not.toContain(".flow-compact-productivity-circle__dial-shell:hover .flow-compact-productivity-circle__segment:not(:hover)");
    expect(motionStyles).not.toContain(".flow-compact-productivity-circle__dial-shell:hover .flow-compact-productivity-circle__center");
    expect(reviewDonutRule).toContain("pointer-events: stroke;");
    expect(reviewDonutRule).toContain("transition: filter 180ms var(--ease-out-quart), stroke-width 180ms var(--ease-out-quart);");
    expect(reviewDonutHoverRule).toContain("filter: brightness(1.08) saturate(1.05);");
    expect(reviewDonutHoverRule).toContain("stroke-width: 19;");
    expect(motionStyles).not.toContain(".eodr-dial-shell:hover");
    expect(barRule).toContain("transition: filter 160ms var(--ease-out-quart), transform 160ms var(--ease-out-quart), opacity 160ms var(--ease-out-quart);");
    expect(barHoverRule).toContain("transform: scaleY(1.35);");
  });

  it("gives focus-drift line and SVG targets hover and keyboard focus emphasis", () => {
    const lineRule = cssRule(motionStyles, ".focus-drift__line");
    const lineHoverRule = cssRule(motionStyles, ".focus-drift:has(.focus-drift-hover-card) .focus-drift__line");
    const targetRule = cssRule(motionStyles, ".focus-drift__target");
    const focusHoverRule = motionStyles.match(/\.focus-drift__target--focus:hover,\s*\.focus-drift__target--focus:focus\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const driftHoverRule = motionStyles.match(/\.focus-drift__target--drift:hover,\s*\.focus-drift__target--drift:focus\s*\{([\s\S]*?)\}/)?.[1] ?? "";

    expect(lineRule).toContain("transition: filter 180ms var(--ease-out-quart), opacity 180ms var(--ease-out-quart), stroke-width 180ms var(--ease-out-quart);");
    expect(lineHoverRule).toContain("filter: drop-shadow(0 0 0.32rem color-mix(in srgb, var(--text) 18%, transparent));");
    expect(targetRule).toContain("transition: fill 180ms var(--ease-out-quart), stroke 180ms var(--ease-out-quart), stroke-width 180ms var(--ease-out-quart), filter 180ms var(--ease-out-quart);");
    expect(focusHoverRule).toContain("stroke-width: 0.68;");
    expect(focusHoverRule).toContain("filter: drop-shadow(0 0 0.42rem color-mix(in srgb, var(--productivity-focus) 34%, transparent));");
    expect(driftHoverRule).toContain("stroke-width: 0.68;");
    expect(driftHoverRule).toContain("filter: drop-shadow(0 0 0.42rem color-mix(in srgb, var(--productivity-drift) 34%, transparent));");
  });

  it("adds Your Week hover motion to the hovered block or bar only", () => {
    const summaryBarRule = motionStyles.match(/\.week-v2-summary__bar-fill,\s*\.week-v2-cat-row__bar span,\s*\.week-v2-rank__bar span\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const summaryBarHoverRule = cssRule(motionStyles, ".week-v2-summary__bar:hover .week-v2-summary__bar-fill");
    const categoryBarHoverRule = motionStyles.match(/\.week-v2-cat-row:hover \.week-v2-cat-row__bar span,\s*\.week-v2-rank li:hover \.week-v2-rank__bar span\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const eventRule = cssRule(motionStyles, ".week-v2-calendar__event");
    const eventHoverRule = cssRule(motionStyles, ".week-v2-calendar__event:hover");

    expect(summaryBarRule).toContain("transform-origin: left bottom;");
    expect(summaryBarRule).toContain("transition: filter 160ms var(--ease-out-quart), transform 160ms var(--ease-out-quart);");
    expect(summaryBarHoverRule).toContain("filter: brightness(1.08) saturate(1.05);");
    expect(summaryBarHoverRule).toContain("transform: scaleY(1.2);");
    expect(categoryBarHoverRule).toContain("filter: brightness(1.08) saturate(1.04);");
    expect(categoryBarHoverRule).toContain("transform: scaleX(1.015);");
    expect(eventRule).toContain("transition: border-color 160ms var(--ease-out-quart), box-shadow 160ms var(--ease-out-quart), filter 160ms var(--ease-out-quart);");
    expect(eventHoverRule).toContain("filter: brightness(1.08) saturate(1.05);");
    expect(eventHoverRule).toContain("0 0 0 1px color-mix(in srgb, white 18%, transparent)");
    expect(motionStyles).not.toContain(".week-v2:hover .week-v2-calendar__event");
    expect(motionStyles).not.toContain(".week-v2-calendar:hover .week-v2-calendar__event");
  });

  it("animates chart hover cards without stealing pointer interactions", () => {
    const hoverCardRule = motionStyles.match(/\.timeline-hover-card,\s*\.flow-hover-card,\s*\.focus-drift-hover-card\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const keyframesRule = motionStyles.match(/@keyframes chart-hover-card-in\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(hoverCardRule).toContain("animation: chart-hover-card-in 160ms var(--ease-out-quart) both;");
    expect(hoverCardRule).toContain("transform-origin: top left;");
    expect(keyframesRule).toContain("opacity: 0;");
    expect(keyframesRule).toContain("transform: translate3d(0, 0.18rem, 0) scale(0.985);");
  });

  it("reduces all chart-hover motion when reduced-motion is requested", () => {
    const reducedMotionBlock = motionStyles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.bar-fill,[\s\S]*?\.focus-drift-hover-card\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(reducedMotionBlock).toContain("transition-duration: 0.01ms !important;");
    expect(reducedMotionBlock).toContain("animation: none !important;");
    expect(reducedMotionBlock).toContain("transform: none !important;");
    expect(reducedMotionBlock).toContain(".week-v2-calendar__event");
    expect(reducedMotionBlock).toContain(".flow-hover-group-highlight");
    expect(motionStyles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.flow-compact-productivity-circle__segment\s*\{[\s\S]*transform:\s*rotate\(-90deg\) !important;/);
  });
});
