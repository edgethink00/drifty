import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCssWithImports } from "./readStyles";

describe("readCssWithImports", () => {
  it("normalizes Windows line endings while inlining imported styles", () => {
    const directory = mkdtempSync(join(tmpdir(), "drifty-read-styles-"));
    try {
      const entryPath = join(directory, "entry.css");
      writeFileSync(entryPath, '@import "./nested.css";\r\n.entry {\r\n  color: red;\r\n}\r\n');
      writeFileSync(join(directory, "nested.css"), ".nested {\r\n  color: blue;\r\n}\r\n");

      const styles = readCssWithImports(entryPath);

      expect(styles).not.toContain("\r");
      expect(styles).toContain(".nested {\n  color: blue;\n}");
      expect(styles).toContain(".entry {\n  color: red;\n}");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
