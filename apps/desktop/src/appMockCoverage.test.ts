import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A whole-module `vi.mock(path, factory)` replaces every export. When App.tsx
 * later starts importing a new value from that module, the factory returns
 * `undefined` for it and the failure surfaces only as a TypeError inside
 * whatever promise happened to call it, which the app tests swallow. That is
 * how the drift alarm gate exemption set (2026-09-18) went undefined under
 * test. Either spread `vi.importActual` in the factory or list every value
 * App.tsx imports from that module.
 */

const srcDir = fileURLToPath(new URL("./", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

export function collectAppValueImports(appSource: string): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>();
  const named = /import\s+\{([^}]*)\}\s+from\s+"(\.\/[^"]+)";/g;
  for (const match of appSource.matchAll(named)) {
    const names = match[1]!
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !name.startsWith("type "))
      .map((name) => name.split(/\s+as\s+/)[0]!.trim());
    if (names.length === 0) continue;
    const set = imports.get(match[2]!) ?? new Set<string>();
    for (const name of names) set.add(name);
    imports.set(match[2]!, set);
  }
  return imports;
}

export type WholeModuleMock = {
  readonly modulePath: string;
  readonly factory: string;
  readonly usesImportActual: boolean;
};

export function collectWholeModuleMocks(testSource: string): WholeModuleMock[] {
  const mocks: WholeModuleMock[] = [];
  const start = /vi\.mock\(\s*"(\.\/[^"]+)"\s*,/g;
  for (const match of testSource.matchAll(start)) {
    const factory = readBalancedCall(testSource, match.index! + match[0].length);
    if (factory === null) continue;
    mocks.push({
      modulePath: match[1]!,
      factory,
      usesImportActual: /importActual|importOriginal/.test(factory),
    });
  }
  return mocks;
}

function readBalancedCall(source: string, from: number): string | null {
  let depth = 1;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(from, index);
    }
  }
  return null;
}

export function findMissingMockedExports(
  appImports: Map<string, Set<string>>,
  mocks: readonly WholeModuleMock[],
): Array<{ modulePath: string; missing: string[] }> {
  const problems: Array<{ modulePath: string; missing: string[] }> = [];
  for (const mock of mocks) {
    if (mock.usesImportActual) continue;
    const needed = appImports.get(mock.modulePath);
    if (!needed) continue;
    const missing = [...needed].filter((name) => !new RegExp(`\\b${name}\\b`).test(mock.factory));
    if (missing.length > 0) problems.push({ modulePath: mock.modulePath, missing });
  }
  return problems;
}

describe("app test mocks cover every value App.tsx imports", () => {
  it("parses named value imports and skips type-only names", () => {
    const imports = collectAppValueImports([
      'import { a, type B, c as d } from "./x";',
      'import type { OnlyType } from "./y";',
      'import { e } from "./x";',
    ].join("\n"));
    expect([...imports.get("./x")!]).toEqual(["a", "c", "e"]);
    expect(imports.has("./y")).toBe(false);
  });

  it("flags a whole-module factory that omits an imported value", () => {
    const mocks = collectWholeModuleMocks('vi.mock("./x", () => ({ a: vi.fn() }));');
    const problems = findMissingMockedExports(new Map([["./x", new Set(["a", "c"])]]), mocks);
    expect(problems).toEqual([{ modulePath: "./x", missing: ["c"] }]);
  });

  it("accepts a factory that spreads importActual", () => {
    const mocks = collectWholeModuleMocks('vi.mock("./x", async () => ({ ...(await vi.importActual("./x")), a: vi.fn() }));');
    expect(findMissingMockedExports(new Map([["./x", new Set(["a", "c"])]]), mocks)).toEqual([]);
  });

  it("holds for every app-level test file", () => {
    const appImports = collectAppValueImports(read("./App.tsx"));
    const testFiles = readdirSync(srcDir).filter((name) => /^app.*\.test\.tsx$/.test(name));
    expect(testFiles.length).toBeGreaterThan(0);
    const problems = testFiles.flatMap((file) => (
      findMissingMockedExports(appImports, collectWholeModuleMocks(read(`./${file}`)))
        .map((problem) => ({ file, ...problem }))
    ));
    expect(problems).toEqual([]);
  });
});
