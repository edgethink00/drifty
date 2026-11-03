import { PROJECT_COLOR_SLOTS, normalizeProjectColor } from "../../lib/colorPalette";

/** The project mark palette, in assignment order (see lib/colorPalette). */
export const PROJECT_COLOR_PALETTE: readonly string[] = PROJECT_COLOR_SLOTS.map((slot) => slot.color);

/**
 * Suggest a project color that isn't already taken. Returns the first palette
 * entry not present in `usedColors`; once every preset is used, picks the
 * least-used slot, breaking ties in palette order. Legacy vivid values count
 * as their slot.
 */
export function firstUnusedProjectColor(usedColors: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const raw of usedColors) {
    const color = normalizeProjectColor(raw);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return PROJECT_COLOR_PALETTE.reduce((best, color) =>
    (counts.get(color) ?? 0) < (counts.get(best) ?? 0) ? color : best,
  );
}

export function isPaletteColor(color: string): boolean {
  const hex = normalizeProjectColor(color);
  return PROJECT_COLOR_PALETTE.some((preset) => preset === hex);
}
