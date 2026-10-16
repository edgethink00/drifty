import { isCustomActivityCategory } from "@drifty/domain";
import type { DayCategory, DayKind, DaySpan } from "./dayNoteFixture";

export const DAY_CATEGORIES: readonly DayCategory[] = ["workspace", "learning", "communication", "music", "game", "socialMedia", "entertainment", "shopping", "utility", "unknown"];
/** Focus, drift, neutral: the order the owner set for productivity (2026-10-08). */
export const DAY_KINDS: readonly DayKind[] = ["focus", "drift", "neutral"];
export type DailyRowKind = "category" | "productivity" | "project";
export type DailyRow = { readonly key: string; readonly minutes: number; readonly cells: readonly number[] };
export type CellApp = { readonly appName: string; readonly bundleId?: string; readonly site?: string; readonly minutes: number };
export type CategoryRow = {
  readonly category: DayCategory;
  readonly minutes: number;
  /** Recorded minutes in each cell (15, 20, 30 or 60 minutes), including minority categories. */
  readonly cells: readonly number[];
};

/** Local review aggregation. The 24-hour window follows the app's day boundary.
 * DaySpan minutes can exceed 1440 for the following calendar morning.
 * Overlapping intervals count once: drift, focus, then neutral; equal priority
 * retains input order. Empty intervals never become recorded time. */
export function dailyFigures(input: readonly DaySpan[], windowStart = 240, cellMinutes = 30) {
  const step = [15, 20, 30, 60].includes(cellMinutes) ? cellMinutes : 30;
  const start = Math.min(1439, Math.max(0, Number.isFinite(windowStart) ? windowStart : 240));
  const end = start + 1440;
  const valid = input.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map(s => ({ ...s, start: Math.max(start, s.start), end: Math.min(end, s.end),
      // A user-added category keeps its own row.
      category: DAY_CATEGORIES.includes(s.category) || isCustomActivityCategory(s.category) ? s.category : "unknown" as DayCategory }))
    .filter(s => s.end > s.start);
  const edges = [...new Set(valid.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
  const priority: Record<DayKind, number> = { drift: 3, focus: 2, neutral: 1 };
  const spans: DaySpan[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i]!; const to = edges[i + 1]!;
    const owner = valid.filter(s => s.start < to && s.end > from).sort((a, b) => priority[b.kind] - priority[a.kind])[0];
    if (owner) spans.push({ ...owner, start: from, end: to });
  }
  const cellsOf = (members: readonly DaySpan[]) => Array.from({ length: 1440 / step }, (_, i) => {
    const from = start + i * step;
    return members.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, from + step) - Math.max(s.start, from)), 0);
  });
  // Rows in order: the built-in categories with the added ones before
  // Unclassified; focus, drift, neutral with added levels after neutral.
  const addedCategories = [...new Set(spans.map(s => s.category).filter(isCustomActivityCategory))];
  const categoryKeys: readonly DayCategory[] = [...DAY_CATEGORIES.filter(category => category !== "unknown"), ...addedCategories, "unknown"];
  const levels = [...new Set(spans.map(s => s.level).filter((level): level is string => Boolean(level)))];
  const keyOf = (by: DailyRowKind, s: DaySpan) => (by === "category" ? s.category : by === "productivity" ? s.level ?? s.kind : s.project);
  const rowsBy = (by: DailyRowKind): DailyRow[] => {
    const keys: readonly string[] = by === "category" ? categoryKeys : by === "productivity" ? [...DAY_KINDS, ...levels]
      : [...new Set(spans.map(s => s.project).filter((name): name is string => Boolean(name)))];
    return keys.map(key => {
      const members = spans.filter(s => keyOf(by, s) === key);
      return { key, minutes: members.reduce((sum, s) => sum + s.end - s.start, 0), cells: cellsOf(members) };
    }).filter(row => row.minutes > 0).sort((a, b) => (by === "project" ? b.minutes - a.minutes : 0));
  };
  const rows: CategoryRow[] = categoryKeys.map(category => {
    const members = spans.filter(s => s.category === category);
    const cells = Array.from({ length: 1440 / step }, (_, i) => {
      const from = start + i * step;
      return members.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, from + step) - Math.max(s.start, from)), 0);
    });
    return { category, minutes: members.reduce((sum, s) => sum + s.end - s.start, 0), cells };
  }).filter(row => row.minutes > 0);
  /** Top apps or sites in one cell of one row, for the cell hover card. Unnamed (private) time is grouped under an empty name. */
  const cellApps = (by: DailyRowKind, key: string, cell: number, limit = 4): CellApp[] => {
    const from = start + cell * step;
    const to = from + step;
    const totals = new Map<string, { appName: string; bundleId?: string; site?: string; minutes: number }>();
    for (const s of spans) {
      if (keyOf(by, s) !== key) continue;
      const minutes = Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
      if (!minutes) continue;
      /* A Chrome extension page records its 32-letter extension id as the site; show the browser instead. */
      const site = s.site && !/^[a-p]{32}$/.test(s.site) ? s.site : undefined;
      const id = site ? "site:" + site : "app:" + (s.bundleId ?? s.app ?? "");
      const entry = totals.get(id) ?? { appName: site ?? s.app ?? "", bundleId: site ? undefined : s.bundleId, site, minutes: 0 };
      entry.minutes += minutes;
      totals.set(id, entry);
    }
    return [...totals.values()].sort((a, b) => b.minutes - a.minutes || a.appName.localeCompare(b.appName)).slice(0, limit);
  };
  return { rows, rowsBy, cellApps, step, total: rows.reduce((sum, row) => sum + row.minutes, 0), start, end };
}
