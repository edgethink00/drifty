#!/usr/bin/env node
// Design token ratchet (2026-11-09).
//
// The app's CSS moved onto shared scales for type size, corner radius and
// colour, but nothing stopped new raw values from creeping back in. This guard
// counts the raw values each stylesheet still holds and fails when a file
// gains one. Existing values are recorded in the baseline and may only go
// down; a file that drops below its baseline is tightened with --update.
//
//   node scripts/design-token-guard.mjs            check against the baseline
//   node scripts/design-token-guard.mjs --update   rewrite the baseline (only lowers counts unless --allow-raise)
//
// A deliberate exception carries "token-exempt: <reason>" in a comment on the
// same line or the line above.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps/desktop/src");
const BASELINE = join(ROOT, "apps/desktop/design-token-baseline.json");

// Files that define the scales themselves.
const SCALE_FILES = new Set(["styles/tokens-base.css", "styles/tokens.css"]);

export const RULES = {
  "font-size": {
    pattern: /font-size:\s*(-?[0-9.]+)(px|rem|em)\b/g,
    allowed: (m) => Number(m[1]) === 0,
    hint: "use a type step: var(--text-2xs … --text-xl) or a --type-* role",
  },
  "border-radius": {
    pattern: /border-radius:\s*([0-9.]+)px\b/g,
    // 0 and the full pill are shapes, not sizes.
    allowed: (m) => Number(m[1]) === 0 || Number(m[1]) >= 999,
    hint: "use a corner step: var(--radius-sm|md|lg|pill) or --block-radius",
  },
  "color": {
    pattern: /(?<![\w-])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
    allowed: () => false,
    hint: "use a colour token: var(--text|surface|line|accent|category-*…)",
  },
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

function stripComments(line) {
  return line.replace(/\/\*.*?\*\//g, "");
}

/** Raw values per rule in one stylesheet's text, with their line numbers. */
export function scanCss(text) {
  const lines = text.split("\n");
  const found = Object.fromEntries(Object.keys(RULES).map((k) => [k, []]));
  let inComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2); inComment = false;
    }
    line = stripComments(line);
    const open = line.indexOf("/*");
    if (open >= 0) { line = line.slice(0, open); inComment = true; }
    const exempt = /token-exempt:/.test(raw) || (i > 0 && /token-exempt:/.test(lines[i - 1]));
    if (exempt) return;
    for (const [key, rule] of Object.entries(RULES)) {
      for (const m of line.matchAll(rule.pattern)) if (!rule.allowed(m)) found[key].push({ line: i + 1, text: m[0] });
    }
  });
  return found;
}

export function scanTree(src = SRC) {
  const counts = {};
  const detail = {};
  for (const file of walk(src).sort()) {
    const rel = relative(src, file).split("\\\\").join("/");
    if (SCALE_FILES.has(rel)) continue;
    const found = scanCss(readFileSync(file, "utf8"));
    const c = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]).filter(([, n]) => n > 0));
    if (Object.keys(c).length) { counts[rel] = c; detail[rel] = found; }
  }
  return { counts, detail };
}

/** Files and rules whose raw-value count rose above the baseline. */
export function compare(counts, baseline) {
  const over = [];
  for (const [file, c] of Object.entries(counts)) {
    for (const [rule, n] of Object.entries(c)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (n > allowed) over.push({ file, rule, count: n, allowed });
    }
  }
  return over;
}

function totals(counts) {
  const t = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
  for (const c of Object.values(counts)) for (const [k, n] of Object.entries(c)) t[k] += n;
  return t;
}

function main(argv) {
  const { counts, detail } = scanTree();
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).files : {};
  if (argv.includes("--update")) {
    const raise = argv.includes("--allow-raise");
    const next = {};
    for (const [file, c] of Object.entries(counts)) {
      const kept = {};
      for (const [rule, n] of Object.entries(c)) {
        const prev = baseline[file]?.[rule];
        kept[rule] = raise || prev === undefined ? n : Math.min(n, prev);
        if (!raise && prev === undefined) kept[rule] = 0;
      }
      if (Object.values(kept).some((n) => n > 0)) next[file] = kept;
    }
    writeFileSync(BASELINE, JSON.stringify({ note: "Raw CSS values per file that predate the design token guard. Counts may only go down; see scripts/design-token-guard.mjs.", totals: totals(next), files: next }, null, 2) + "\n");
    console.log("design-token-guard: baseline written", JSON.stringify(totals(next)));
    return 0;
  }
  const over = compare(counts, baseline);
  const t = totals(counts);
  if (over.length === 0) {
    console.log("design-token-guard: ok", JSON.stringify(t));
    return 0;
  }
  console.error("design-token-guard: new raw CSS values (the scale has a token for these):");
  for (const o of over) {
    console.error("  " + o.file + "  " + o.rule + ": " + o.count + " (baseline " + o.allowed + ") — " + RULES[o.rule].hint);
    for (const hit of detail[o.file][o.rule].slice(-(o.count - o.allowed))) console.error("      line " + hit.line + ": " + hit.text);
  }
  console.error("Use the token, or mark a deliberate exception with /* token-exempt: <reason> */.");
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
