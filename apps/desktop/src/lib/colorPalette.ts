/**
 * The one app palette.
 *
 * Categories, productivity states, the accent and project marks all draw from
 * this desaturated "balanced" family, so a stacked chart reads as one product
 * whichever series it is showing. Project marks are ten named slots out of
 * the same family; the legacy vivid values they used to ship with resolve to
 * their slot at load time, so stored data never needs migrating.
 */

export type ColorPreset = {
  readonly id: string;
  readonly color: string;
};

export const BALANCED_PRESETS = [
  { id: "moss", color: "#5f7f31" },
  { id: "fern", color: "#4f751e" },
  { id: "teal", color: "#2f7f78" },
  { id: "cyan", color: "#3a8ea5" },
  { id: "blue", color: "#476f8f" },
  { id: "indigo", color: "#5366a3" },
  { id: "violet", color: "#7b5ea7" },
  { id: "plum", color: "#9b5b91" },
  { id: "rose", color: "#b9565b" },
  { id: "berry", color: "#b24f79" },
  { id: "wine", color: "#8f3f5f" },
  { id: "clay", color: "#a34139" },
  { id: "coral", color: "#c05d48" },
  { id: "rust", color: "#b96a3f" },
  { id: "copper", color: "#9a6530" },
  { id: "ochre", color: "#a1792f" },
  { id: "gold", color: "#b58a2a" },
  { id: "olive", color: "#7d7a35" },
  { id: "sand", color: "#a49a84" },
  { id: "stone", color: "#7d786f" },
  { id: "slate", color: "#66707a" },
  { id: "charcoal", color: "#4d4b45" },
] as const satisfies readonly ColorPreset[];

export type BalancedPreset = (typeof BALANCED_PRESETS)[number];
export type BalancedPresetId = BalancedPreset["id"];

export type ProjectColorSlot = {
  /** Display name key; localized by the project editor. */
  readonly name: string;
  readonly color: string;
  /** The Tailwind value this slot shipped with before the palette was unified. */
  readonly legacy: string;
};

/** Ten hue-spaced slots, in the order new projects are assigned. */
export const PROJECT_COLOR_SLOTS = [
  { name: "Indigo", color: "#5366a3", legacy: "#6366f1" },
  { name: "Pink", color: "#9b5b91", legacy: "#ec4899" },
  { name: "Amber", color: "#a1792f", legacy: "#f59e0b" },
  { name: "Emerald", color: "#2f7f78", legacy: "#10b981" },
  { name: "Blue", color: "#476f8f", legacy: "#3b82f6" },
  { name: "Violet", color: "#7b5ea7", legacy: "#8b5cf6" },
  { name: "Red", color: "#a34139", legacy: "#ef4444" },
  { name: "Teal", color: "#3a8ea5", legacy: "#14b8a6" },
  { name: "Orange", color: "#b96a3f", legacy: "#f97316" },
  { name: "Lime", color: "#7d7a35", legacy: "#84cc16" },
] as const satisfies readonly ProjectColorSlot[];

export function normalizeHex(color: string): string {
  return color.trim().toLowerCase();
}

const LEGACY_TO_SLOT: ReadonlyMap<string, string> = new Map(
  PROJECT_COLOR_SLOTS.map((slot) => [normalizeHex(slot.legacy), slot.color]),
);

/**
 * Stored project color → the color the app renders. Legacy vivid values map to
 * their slot; anything else (custom colors) passes through unchanged.
 */
export function normalizeProjectColor(color: string): string {
  const hex = normalizeHex(color);
  return LEGACY_TO_SLOT.get(hex) ?? hex;
}

export function presetForColor(color: string): BalancedPreset | undefined {
  const hex = normalizeHex(color);
  return BALANCED_PRESETS.find((preset) => preset.color === hex);
}
