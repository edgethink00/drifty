import type { ActivityCategory, CategoryDuration, ProductivityLabel } from "@drifty/domain";

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
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

export const PRODUCTIVITY_COLORS: Record<ProductivityLabel, string> = {
  focus: "var(--flow-tone-focus)",
  neutral: "var(--flow-tone-neutral)",
  drift: "var(--flow-tone-drift)",
};

export const FLOW_BREAKDOWN_PRODUCTIVITY_ORDER: ProductivityLabel[] = ["focus", "drift", "neutral"];

export function categoryLabel(category: CategoryDuration["category"]) {
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
    case "unknown": return "Unknown";
  }
}

export function productivityLabel(productivity: ProductivityLabel) {
  switch (productivity) { case "focus": return "Focus"; case "neutral": return "Neutral"; case "drift": return "Drift"; }
}

export function isProductivityLabel(value: unknown): value is ProductivityLabel {
  return value === "focus" || value === "neutral" || value === "drift";
}
