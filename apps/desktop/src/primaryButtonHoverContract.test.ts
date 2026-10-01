import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Every hover rule for a filled primary action in the app, settings, and modal button families. */
function primaryHoverRules() {
  const rules: { file: string; selector: string; body: string }[] = [];
  for (const file of cssFiles(srcRoot)) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      // Exclusions such as :not(.app-btn--primary) describe other buttons, so drop them before matching.
      if (/(app|settings|modal)-btn--primary[^,{]*:hover/.test(selector.replace(/:not\([^)]*\)/g, ""))) rules.push({ file: file.slice(srcRoot.length), selector, body: match[2] });
    }
  }
  return rules;
}

// Owner decision 2026-09-30: a filled ink button reacts on the neutral ink ramp.
// Jumping from ink to the green accent read as a different button, and in
// step-by-step flows the cursor rests on the button so users mostly saw green.
describe("primary button hover", () => {
  const rules = primaryHoverRules();

  it("finds the shared app, settings, and modal primary hover rules", () => {
    expect(rules.length).toBeGreaterThanOrEqual(9);
    expect(rules.some(rule => rule.file.endsWith("app-buttons.css"))).toBe(true);
  });

  it.each(primaryHoverRules().map(rule => [rule.file + " " + rule.selector, rule.body]))("%s stays on the ink ramp", (_name, body) => {
    expect(body).not.toMatch(/var\(--accent(-mid|-strong|-wash)?\)/);
    expect(body).toMatch(/background:\s*var\(--text-muted\)/);
  });
});
