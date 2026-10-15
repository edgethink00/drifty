import type { ActivityCategory, ProductivityLabel } from "./activity";
import {
  LIVE_CATEGORY_GUIDANCE_DESCRIPTION_MAX_LENGTH,
  LIVE_CATEGORY_GUIDANCE_NAME_MAX_LENGTH,
  LIVE_GUIDABLE_CATEGORIES,
  LIVE_PRODUCTIVITY_LABELS,
  normalizeLiveCategoryGuidance,
  type LiveCategoryGuidance,
} from "./liveClassificationPolicy";

/**
 * Per-category settings a user can change for Drifty's built-in categories.
 *
 * The category keys themselves never change: every stored classification,
 * aggregate, built-in rule, and shared surface (Focus Card, leaderboard, teams)
 * keeps using them. A custom name is a local display label only, a description
 * steers the classification model, and a productivity preference pins the
 * productivity of non-manual results in that category.
 */
export const CATEGORY_CUSTOM_NAME_MAX_LENGTH = LIVE_CATEGORY_GUIDANCE_NAME_MAX_LENGTH;
export const CATEGORY_DESCRIPTION_MAX_LENGTH = LIVE_CATEGORY_GUIDANCE_DESCRIPTION_MAX_LENGTH;

/** `unknown` stays the system fallback and cannot be customized. */
export const CUSTOMIZABLE_CATEGORIES: readonly ActivityCategory[] = LIVE_GUIDABLE_CATEGORIES;

export interface CategoryCustomization {
  /** Display name on this device; shared surfaces keep the built-in label. */
  readonly name?: string;
  /** Boundary description the classification model reads. */
  readonly description?: string;
  /** Fixed productivity for this category; absent keeps Drifty's judgment. */
  readonly productivity?: ProductivityLabel;
  /**
   * When the user deleted the category (ISO time). It is not used for activity
   * from then on, while earlier records keep its name and color; restoring it
   * removes the time.
   */
  readonly deletedAt?: string;
}

export type CategoryCustomizations = Readonly<Partial<Record<ActivityCategory, CategoryCustomization>>>;
export type CategoryProductivityPreferences = Readonly<Partial<Record<ActivityCategory, ProductivityLabel>>>;

function clipCharacters(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("").trim();
}

function cleanCategoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = clipCharacters(value.replace(/\s+/g, " ").trim(), CATEGORY_CUSTOM_NAME_MAX_LENGTH);
  return cleaned || null;
}

function cleanCategoryDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = clipCharacters(value.replace(/\r\n?/g, "\n").trim(), CATEGORY_DESCRIPTION_MAX_LENGTH);
  return cleaned || null;
}

function isProductivityLabel(value: unknown): value is ProductivityLabel {
  return value === "focus" || value === "neutral" || value === "drift";
}

export function normalizeCategoryCustomization(value: unknown): CategoryCustomization | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = cleanCategoryName(record.name);
  const description = cleanCategoryDescription(record.description);
  const productivity = isProductivityLabel(record.productivity) ? record.productivity : null;
  const deletedAt = typeof record.deletedAt === "string" && Number.isFinite(Date.parse(record.deletedAt))
    ? new Date(record.deletedAt).toISOString()
    : null;
  if (!name && !description && !productivity && !deletedAt) return null;
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(productivity ? { productivity } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

export function normalizeCategoryCustomizations(value: unknown): CategoryCustomizations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Record<ActivityCategory, CategoryCustomization>> = {};
  for (const category of CUSTOMIZABLE_CATEGORIES) {
    const entry = normalizeCategoryCustomization(record[category]);
    if (entry) result[category] = entry;
  }
  return result;
}

/**
 * The model-facing guidance: only categories with a description, plus their
 * custom name. A deleted category is no longer offered, so its words are not sent.
 */
export function categoryGuidanceFromCustomizations(customizations: CategoryCustomizations): LiveCategoryGuidance[] {
  return normalizeLiveCategoryGuidance(
    CUSTOMIZABLE_CATEGORIES.flatMap((category) => {
      const entry = customizations[category];
      if (!entry?.description || entry.deletedAt) return [];
      return [{ category, ...(entry.name ? { name: entry.name } : {}), description: entry.description }];
    }),
  );
}

export function categoryProductivityPreferences(customizations: CategoryCustomizations): CategoryProductivityPreferences {
  const result: Partial<Record<ActivityCategory, ProductivityLabel>> = {};
  for (const category of CUSTOMIZABLE_CATEGORIES) {
    const productivity = customizations[category]?.productivity;
    if (productivity) result[category] = productivity;
  }
  return result;
}

/** Each deleted category with the time it was deleted, for classification options. */
export function deletedCategoryCutoffs(customizations: CategoryCustomizations): Readonly<Partial<Record<ActivityCategory, string>>> {
  const result: Partial<Record<ActivityCategory, string>> = {};
  for (const category of CUSTOMIZABLE_CATEGORIES) {
    const deletedAt = customizations[category]?.deletedAt;
    if (deletedAt) result[category] = deletedAt;
  }
  return result;
}

/** Deleted categories, which the classifier is no longer offered. */
export function deletedCategories(customizations: CategoryCustomizations): ActivityCategory[] {
  return CUSTOMIZABLE_CATEGORIES.filter((category) => Boolean(customizations[category]?.deletedAt));
}

export function categoryNameOverrides(customizations: CategoryCustomizations): Readonly<Partial<Record<ActivityCategory, string>>> {
  const result: Partial<Record<ActivityCategory, string>> = {};
  for (const category of CUSTOMIZABLE_CATEGORIES) {
    const name = customizations[category]?.name;
    if (name) result[category] = name;
  }
  return result;
}

/** Stable identity of what the model reads; equal keys mean identical prompts. */
export function categoryGuidanceKey(guidance: readonly LiveCategoryGuidance[]): string {
  return JSON.stringify(normalizeLiveCategoryGuidance(guidance));
}

/** Whether a settings change alters what the classification model reads. */
export function categoryGuidanceChanged(previous: CategoryCustomizations, next: CategoryCustomizations): boolean {
  return categoryGuidanceKey(categoryGuidanceFromCustomizations(previous))
    !== categoryGuidanceKey(categoryGuidanceFromCustomizations(next));
}

/**
 * Per-label settings for Drifty's three productivity labels. Like categories,
 * the label keys never change: a name is a local display label and a
 * description is the user's boundary the classification model reads.
 */
export const CUSTOMIZABLE_PRODUCTIVITY_LABELS: readonly ProductivityLabel[] = LIVE_PRODUCTIVITY_LABELS;

export interface ProductivityCustomization {
  readonly name?: string;
  readonly description?: string;
}

export type ProductivityCustomizations = Readonly<Partial<Record<ProductivityLabel, ProductivityCustomization>>>;

export function normalizeProductivityCustomization(value: unknown): ProductivityCustomization | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = cleanCategoryName(record.name);
  const description = cleanCategoryDescription(record.description);
  if (!name && !description) return null;
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

export function normalizeProductivityCustomizations(value: unknown): ProductivityCustomizations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Record<ProductivityLabel, ProductivityCustomization>> = {};
  for (const label of CUSTOMIZABLE_PRODUCTIVITY_LABELS) {
    const entry = normalizeProductivityCustomization(record[label]);
    if (entry) result[label] = entry;
  }
  return result;
}

export function productivityNameOverrides(customizations: ProductivityCustomizations): Readonly<Partial<Record<ProductivityLabel, string>>> {
  const result: Partial<Record<ProductivityLabel, string>> = {};
  for (const label of CUSTOMIZABLE_PRODUCTIVITY_LABELS) {
    const name = customizations[label]?.name;
    if (name) result[label] = name;
  }
  return result;
}

/**
 * Everything the classification model reads from the user's definitions:
 * described categories, described productivity labels, and deleted categories.
 */
export function classificationGuidanceFromCustomizations(
  categories: CategoryCustomizations,
  productivity: ProductivityCustomizations,
): LiveCategoryGuidance[] {
  return normalizeLiveCategoryGuidance([
    ...categoryGuidanceFromCustomizations(categories),
    // Deleted categories: the model must not return them for new activity.
    ...deletedCategories(categories).map((category) => ({ category, removed: true as const })),
    ...CUSTOMIZABLE_PRODUCTIVITY_LABELS.flatMap((label) => {
      const entry = productivity[label];
      if (!entry?.description) return [];
      return [{ productivity: label, ...(entry.name ? { name: entry.name } : {}), description: entry.description }];
    }),
  ]);
}

/** Whether a change to either kind of definition alters what the model reads. */
export function classificationGuidanceChanged(
  previous: { readonly categories: CategoryCustomizations; readonly productivity: ProductivityCustomizations },
  next: { readonly categories: CategoryCustomizations; readonly productivity: ProductivityCustomizations },
): boolean {
  return categoryGuidanceKey(classificationGuidanceFromCustomizations(previous.categories, previous.productivity))
    !== categoryGuidanceKey(classificationGuidanceFromCustomizations(next.categories, next.productivity));
}
