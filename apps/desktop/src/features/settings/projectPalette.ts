/** Curated, visually distinct project colors — the preset palette for the picker. */
export const PROJECT_COLOR_PALETTE = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
] as const;

function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

/**
 * Suggest a project color that isn't already taken. Returns the first palette
 * entry not present in `usedColors`; once every preset is used, cycles so new
 * projects still vary instead of all defaulting to the same color.
 */
export function firstUnusedProjectColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors.map(normalizeColor));
  const free = PROJECT_COLOR_PALETTE.find((color) => !used.has(normalizeColor(color)));
  if (free) return free;
  return PROJECT_COLOR_PALETTE[used.size % PROJECT_COLOR_PALETTE.length];
}

export function isPaletteColor(color: string): boolean {
  return PROJECT_COLOR_PALETTE.some((preset) => normalizeColor(preset) === normalizeColor(color));
}
