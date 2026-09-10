import { PROJECT_COLOR_SLOTS, normalizeProjectColor } from "../../lib/colorPalette";

/** The project mark palette, in assignment order (see lib/colorPalette). */
export const PROJECT_COLOR_PALETTE: readonly string[] = PROJECT_COLOR_SLOTS.map((slot) => slot.color);

/**
 * Suggest a project color that isn't already taken. Returns the first palette
 * entry not present in `usedColors`; once every preset is used, cycles so new
 * projects still vary instead of all defaulting to the same color. Legacy
 * vivid values count as their slot.
 */
export function firstUnusedProjectColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors.map(normalizeProjectColor));
  const free = PROJECT_COLOR_PALETTE.find((color) => !used.has(color));
  if (free) return free;
  return PROJECT_COLOR_PALETTE[used.size % PROJECT_COLOR_PALETTE.length];
}

export function isPaletteColor(color: string): boolean {
  const hex = normalizeProjectColor(color);
  return PROJECT_COLOR_PALETTE.some((preset) => preset === hex);
}
