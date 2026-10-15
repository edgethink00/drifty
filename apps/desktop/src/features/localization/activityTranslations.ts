import type { ActivityCategory, ExclusionSource, ProductivityLabel } from "@drifty/domain";
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
    // A user-added category reads by the name the user gave it (the name
    // overrides fill it in); one this device does not know reads as Other.
    default: return t("activity.category.custom", { id: category });
  }
}

export function localizedProductivityLabel(productivity: ProductivityLabel, t: LocalizationController["t"]): string {
  switch (productivity) {
    case "focus": return t("activity.productivity.focus");
    case "drift": return t("activity.productivity.drift");
    case "neutral": return t("activity.productivity.neutral");
  }
}

export function excludedActivityLabel(
  source: ExclusionSource | null | undefined,
  t: LocalizationController["t"],
): string {
  return source === "user" ? t("activity.excluded.user") : t("activity.excluded.default");
}

export function localizedExcludedIdentityLabel(
  identity: { readonly id: string; readonly label: string; readonly exclusionSource?: ExclusionSource | null },
  t: LocalizationController["t"],
): string {
  if (identity.id === "excluded") return excludedActivityLabel(identity.exclusionSource, t);
  return identity.label;
}
