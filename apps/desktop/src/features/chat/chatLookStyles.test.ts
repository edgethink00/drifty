import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Chat look v1.1 (owner choice 2026-10-29, docs/product-decisions.md "Chat look v1.1"):
 * the composer sits just off the page without a wide grey halo.
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
});
