import type { ActivityCategory, ProductivityLabel } from "@drifty/domain";
import type { LocalizationController } from "./LocalizationContext";

export function localizedCategoryLabel(category: ActivityCategory, t: LocalizationController["t"]): string {
  switch (category) {
    case "workspace": return t("activity.category.workspace");
    case "learning": return t("activity.category.learning");
    case "communication": return t("activity.category.communication");
    case "music": return t("activity.category.music");
    case "game": return t("activity.category.game");
    case "social_media": return t("activity.category.socialMedia");
    case "entertainment": return t("activity.category.entertainment");
    case "shopping": return t("activity.category.shopping");
    case "utility": return t("activity.category.utility");
    case "unknown": return t("activity.category.unknown");
  }
}

export function localizedProductivityLabel(productivity: ProductivityLabel, t: LocalizationController["t"]): string {
  switch (productivity) {
    case "focus": return t("activity.productivity.focus");
    case "drift": return t("activity.productivity.drift");
    case "neutral": return t("activity.productivity.neutral");
  }
}
