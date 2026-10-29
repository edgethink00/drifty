import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Chat look v1.1 (owner choice 2026-10-29, docs/product-decisions.md "Chat look v1.1"):
 * the composer sits just off the page without a wide grey halo, and conversation text
 * dissolves above the composer while the last 1rem above the box stays clear.
 */
const css = readFileSync(resolve(__dirname, "chat.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf("\n" + selector + " {");
  expect(start, selector + " is styled").toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

function remOrPx(value: string): number {
  const amount = Number.parseFloat(value);
  return value.endsWith("rem") ? amount * 16 : amount;
}

describe("Chat look v1.1", () => {
  it("lifts the composer with a short shadow instead of a wide halo, in light and dark", () => {
    for (const scope of [".chat-page", ':root[data-theme="dark"] .chat-page']) {
      const shadow = /--chat-composer-shadow:\s*([^;]+);/.exec(block(scope))?.[1] ?? "";
      const layers = shadow.split(/,(?![^(]*\))/).map((layer) => layer.replace(/rgba?\([^)]*\)/, "").trim().split(/\s+/));
      expect(layers.length).toBeGreaterThan(0);
      for (const [, offsetY, blur] of layers) {
        expect(remOrPx(offsetY), scope + " shadow offset").toBeLessThanOrEqual(10);
        expect(remOrPx(blur), scope + " shadow blur").toBeLessThanOrEqual(26);
      }
    }
    expect(block(".chat-composer__box")).toContain("box-shadow: var(--chat-composer-shadow)");
  });

  it("fades the thread over the composer and keeps the last 1rem above the box clear", () => {
    const composer = block(".chat-composer");
    const paddingTop = remOrPx(/padding:\s*([\d.]+rem)/.exec(composer)?.[1] ?? "0");
    const stops = [...composer.matchAll(/([\d.]+rem)\s*\)?\s*(?:,|\n\s*\))/g)].map((match) => remOrPx(match[1]));
    const solidFrom = Math.max(...stops);
    expect(solidFrom, "fade length").toBeGreaterThanOrEqual(40);
    expect(paddingTop - solidFrom, "clear band above the composer").toBeGreaterThanOrEqual(16);
  });
});

