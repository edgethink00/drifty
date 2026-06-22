import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function inlineCssImports(filePath: string, visited = new Set<string>()): string {
  const absolutePath = resolve(filePath);
  if (visited.has(absolutePath)) {
    return "";
  }
  visited.add(absolutePath);

  const css = readFileSync(absolutePath, "utf8");
  return css.replace(/^@import\s+["']([^"']+)["'];\s*$/gm, (_match, importPath: string) => {
    return inlineCssImports(resolve(dirname(absolutePath), importPath), visited);
  });
}

export function readAppStyles(): string {
  return inlineCssImports("src/styles.css");
}
