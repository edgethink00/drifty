import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockTitleText } from "../components/BlockTitleText";

const SRC_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC_ROOT, rel), "utf8");

describe("block heads", () => {
  // Owner decision 2026-11-06: block titles start 15px in from the block edge
  // with their cap line 15px below the top, at 12px / 500 / soft ink.
  it("defines the 15px block inset and loads the shared block-head layer", () => {
    const tokens = read("styles/tokens-base.css");
    expect(tokens).toContain("--block-inset: 15px;");
    expect(tokens).toContain("--block-pad: calc(var(--block-inset) - 1px);");
    expect(tokens).toContain("--block-title-leading: 16px;");
    expect(tokens).toContain("--block-pad-top: calc(var(--block-pad) - 4.2px);");
    expect(read("styles.css")).toContain('@import "./styles/block-heads.css";');
  });

  it("sets every block title in one style and places each surface's head on the inset", () => {
    const css = read("styles/block-heads.css");
    expect(css).toMatch(/\.lb7-cardhead \.lb7-label,[\s\S]*?\) \{\s*color: var\(--text-soft\);\s*font-size: var\(--text-xs\);\s*font-weight: 500;/);
    for (const selector of [
      ".app-shell .content--trends .focus-calendar",
      ".app-shell .content--trends .productivity-insight-group",
      ".app-shell .projects-page :is(.ptc-panel--overview, .projects-share).insight-chart-panel.editorial-panel",
      ".app-shell .lb7 .lb7-hall",
      ".app-shell .classification-panel-view__panel-header.panel-header",
    ]) {
      expect(css, selector).toContain(selector + " {");
    }
    expect(css).toContain("padding-inline: calc(var(--block-pad) - 4px);");
  });

  it("keeps a trailing period or count on the title line at a lighter weight", () => {
    expect(renderToStaticMarkup(<BlockTitleText text="Project allocation · latest 7 days" />)).toBe(
      'Project allocation<span class="block-title__meta"> · latest 7 days</span>',
    );
    expect(renderToStaticMarkup(<BlockTitleText text="최근 7일 Top 3" />)).toBe("최근 7일 Top 3");
  });
});
