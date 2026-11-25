import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagnosticCode } from "./feedbackDiagnosticsProjection";

// A diagnostic reaches feedback only when it is on the allowlist; any other
// code collapses to "other" and hides why a Windows close was refused.
describe("Windows browser automation diagnostics", () => {
  it("keeps every windows_uia code the native code returns", () => {
    const nativeRoot = fileURLToPath(new URL("../../../src-tauri/src/", import.meta.url));
    const codes = new Set<string>();
    for (const file of readdirSync(nativeRoot, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".rs")) continue;
      for (const [, code] of readFileSync(nativeRoot + file, "utf8").matchAll(/"(windows_uia_[a-z_]+)"/g)) {
        codes.add(code);
      }
    }
    expect(codes.size).toBeGreaterThan(20);
    expect([...codes].filter((code) => diagnosticCode(code) !== code)).toEqual([]);
  });
});
