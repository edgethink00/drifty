import type { ActivityCategory, CategoryDuration, ProductivityLabel } from "@drifty/domain";

const BUILT_IN_CATEGORY_COLORS: Record<string, string> = {
  workspace: "var(--category-workspace)",
  learning: "var(--category-learning)",
  communication: "var(--category-communication)",
  music: "var(--category-music)",
  game: "var(--category-game)",
  social_media: "var(--category-social-media)",
  entertainment: "var(--category-entertainment)",
  shopping: "var(--category-shopping)",
  utility: "var(--category-utility)",
  unknown: "var(--category-unknown)",
};

/**
 * Category colors as CSS variables. A user-added category answers with its own
 * variable (set from the color it was given), falling back to Unclassified's.
 */
export const CATEGORY_COLORS: Readonly<Record<ActivityCategory, string>> = new Proxy(BUILT_IN_CATEGORY_COLORS, {
  get(target, key) {
    if (typeof key === "string" && !(key in target) && key.startsWith("custom-")) {
      return `var(--category-${key}, var(--category-unknown))`;
    }
    return Reflect.get(target, key);
  },
}) as Readonly<Record<ActivityCategory, string>>;

export const PRODUCTIVITY_COLORS: Record<ProductivityLabel, string> = {
  focus: "var(--flow-tone-focus)",
  neutral: "var(--flow-tone-neutral)",
  drift: "var(--flow-tone-drift)",
};

export const FLOW_BREAKDOWN_PRODUCTIVITY_ORDER: ProductivityLabel[] = ["focus", "drift", "neutral"];

export function categoryLabel(category: CategoryDuration["category"]): string {
  switch (category) {
    case "workspace": return "Workspace";
    case "learning": return "Learning";
    case "communication": return "Communication";
    case "music": return "Music";
    case "game": return "Game";
    case "social_media": return "Social media";
    case "entertainment": return "Entertainment";
    case "shopping": return "Shopping";
    case "utility": return "Utility";
    case "unknown": return "Unclassified";
    // A user-added category: in-app views use its name through the localized label.
    default: return "Other";
  }
}

export function productivityLabel(productivity: ProductivityLabel) {
  switch (productivity) { case "focus": return "Focus"; case "neutral": return "Neutral"; case "drift": return "Drift"; }
}

export function isProductivityLabel(value: unknown): value is ProductivityLabel {
  return value === "focus" || value === "neutral" || value === "drift";
}
