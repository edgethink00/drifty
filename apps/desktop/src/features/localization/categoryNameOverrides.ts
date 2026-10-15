import type { ActivityCategory, ProductivityLabel } from "@drifty/domain";
import type { TranslationKey } from "./translations";
import type { Translate } from "./translate";

const CATEGORY_KEY_BY_TRANSLATION_KEY: Readonly<Partial<Record<TranslationKey, ActivityCategory>>> = {
  "activity.category.workspace": "workspace",
  "activity.category.learning": "learning",
  "activity.category.communication": "communication",
  "activity.category.music": "music",
  "activity.category.game": "game",
  "activity.category.socialMedia": "social_media",
  "activity.category.entertainment": "entertainment",
  "activity.category.shopping": "shopping",
  "activity.category.utility": "utility",
};

const PRODUCTIVITY_KEY_BY_TRANSLATION_KEY: Readonly<Partial<Record<TranslationKey, ProductivityLabel>>> = {
  "activity.productivity.focus": "focus",
  "activity.productivity.neutral": "neutral",
  "activity.productivity.drift": "drift",
};

/** Names the user chose in the category editor, for categories and productivity labels. */
export type LabelOverrides = {
  readonly categories?: Readonly<Partial<Record<ActivityCategory, string>>>;
  readonly productivity?: Readonly<Partial<Record<ProductivityLabel, string>>>;
};

/**
 * In-app category and productivity labels follow the names a user chose in
 * Settings. Shared surfaces (share images, Focus Card, leaderboard, teams) do
 * not render through this translator, so they keep the built-in names.
 */
export function withCategoryNameOverrides(translate: Translate, overrides: LabelOverrides): Translate {
  const categories = overrides.categories ?? {};
  const productivity = overrides.productivity ?? {};
  if (Object.keys(categories).length === 0 && Object.keys(productivity).length === 0) return translate;
  return (key, params) => {
    const category = CATEGORY_KEY_BY_TRANSLATION_KEY[key];
    if (category && categories[category]) return categories[category] as string;
    const label = PRODUCTIVITY_KEY_BY_TRANSLATION_KEY[key];
    if (label && productivity[label]) return productivity[label] as string;
    return translate(key, params);
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function parseCategoryNameOverrideKey(key: string): LabelOverrides {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return { categories: stringRecord(record.categories), productivity: stringRecord(record.productivity) };
  } catch {
    return {};
  }
}
