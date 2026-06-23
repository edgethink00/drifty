import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CSS_IMPORT_PATTERN = /^import\s+["']([^"']+\.css)["'];\s*$/gm;

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

export function readCssWithImports(filePath: string): string {
  return inlineCssImports(filePath);
}

export function readAppStyles(): string {
  const entryPath = resolve("src/main.tsx");
  const entrySource = readFileSync(entryPath, "utf8");
  let styles = "";

  for (const match of entrySource.matchAll(CSS_IMPORT_PATTERN)) {
    const importPath = match[1];
    if (!importPath) continue;
    styles += `\n${inlineCssImports(resolve(dirname(entryPath), importPath))}`;
  }

  return styles;
}
