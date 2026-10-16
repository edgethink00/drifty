import { isCustomActivityCategory, type ActivityCategory, type CustomActivityCategory, type ProductivityLabel } from "./activity";
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
  /** A user-added category's color (built-in colors live with the other color overrides). */
  readonly color?: string;
  /** When a user-added category was created; it orders the added categories. */
  readonly createdAt?: string;
  /** The added productivity level this category is fixed to (its productivity is then neutral). */
  readonly level?: CustomProductivityLevel;
}

/**
 * A productivity level the user added beside focus, neutral, and drift. It
 * groups the categories fixed to it under its own name and color in the app;
 * wherever a score is kept (focus share, leaderboard, share card) its time is
 * neutral, so a category fixed to it is stored as neutral with this id.
 */
export type CustomProductivityLevel = `level-${string}`;

const CUSTOM_PRODUCTIVITY_LEVEL_PATTERN = /^level-[a-z0-9]{4,32}$/;

export function isCustomProductivityLevel(value: unknown): value is CustomProductivityLevel {
  return typeof value === "string" && CUSTOM_PRODUCTIVITY_LEVEL_PATTERN.test(value);
}

/** Added productivity levels allowed beside the three built-in ones. */
export const MAX_ADDED_PRODUCTIVITY_LEVELS = 3;

/** A new id for a user-added productivity level. */
export function newProductivityLevelId(random: () => number = Math.random): CustomProductivityLevel {
  const suffix = Array.from({ length: 8 }, () => Math.floor(random() * 36).toString(36)).join("");
  return `level-${suffix}`;
}

/** Built-in and user-added categories together; the editor allows up to this many. */
export const MAX_CATEGORY_COUNT = 20;

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
  // A category fixed to an added level counts as neutral wherever a score is kept.
  const level = isCustomProductivityLevel(record.level) ? record.level : null;
  const productivity = level ? "neutral" : isProductivityLabel(record.productivity) ? record.productivity : null;
  const deletedAt = typeof record.deletedAt === "string" && Number.isFinite(Date.parse(record.deletedAt))
    ? new Date(record.deletedAt).toISOString()
    : null;
  if (!name && !description && !productivity && !deletedAt) return null;
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(productivity ? { productivity } : {}),
    ...(level ? { level } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

function isoTime(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/** A user-added category needs a name; its color and creation time come along. */
export function normalizeCustomCategoryCustomization(value: unknown): CategoryCustomization | null {
  const entry = normalizeCategoryCustomization(value);
  if (!entry?.name) return null;
  const record = value as Record<string, unknown>;
  const color = typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color.toLowerCase() : null;
  const createdAt = isoTime(record.createdAt);
  return { ...entry, ...(color ? { color } : {}), ...(createdAt ? { createdAt } : {}) };
}

export function normalizeCategoryCustomizations(value: unknown): CategoryCustomizations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Record<ActivityCategory, CategoryCustomization>> = {};
  for (const category of CUSTOMIZABLE_CATEGORIES) {
    const entry = normalizeCategoryCustomization(record[category]);
    if (entry) result[category] = entry;
  }
  for (const key of Object.keys(record)) {
    if (!isCustomActivityCategory(key)) continue;
    const entry = normalizeCustomCategoryCustomization(record[key]);
    if (entry) result[key] = entry;
  }
  return result;
}

/** User-added categories in the order they were created (deleted ones included). */
export function customCategoryIds(customizations: CategoryCustomizations): CustomActivityCategory[] {
  return (Object.keys(customizations).filter(isCustomActivityCategory) as CustomActivityCategory[])
    .sort((left, right) => (customizations[left]?.createdAt ?? "").localeCompare(customizations[right]?.createdAt ?? "") || left.localeCompare(right));
}

/** Every category the user can define: the built-in ones, then the added ones. */
export function definedCategories(customizations: CategoryCustomizations): ActivityCategory[] {
  return [...CUSTOMIZABLE_CATEGORIES, ...customCategoryIds(customizations)];
}

/** A new id for a user-added category. */
export function newCustomCategoryId(random: () => number = Math.random): CustomActivityCategory {
  const suffix = Array.from({ length: 8 }, () => Math.floor(random() * 36).toString(36)).join("");
  return `custom-${suffix}`;
}

/**
 * The model-facing guidance: only categories with a description, plus their
 * custom name. A deleted category is no longer offered, so its words are not sent.
 */
export function categoryGuidanceFromCustomizations(customizations: CategoryCustomizations): LiveCategoryGuidance[] {
  return normalizeLiveCategoryGuidance([
    ...CUSTOMIZABLE_CATEGORIES.flatMap((category) => {
      const entry = customizations[category];
      if (!entry?.description || entry.deletedAt) return [];
      return [{ category, ...(entry.name ? { name: entry.name } : {}), description: entry.description }];
    }),
    // A user-added category is offered to the classifier by its id, name, and words.
    ...customCategoryIds(customizations).flatMap((category) => {
      const entry = customizations[category];
      if (!entry?.name || entry.deletedAt) return [];
      return [{ category, name: entry.name, ...(entry.description ? { description: entry.description } : {}), added: true as const }];
    }),
  ]);
}

export function categoryProductivityPreferences(customizations: CategoryCustomizations): CategoryProductivityPreferences {
  const result: Partial<Record<ActivityCategory, ProductivityLabel>> = {};
  for (const category of definedCategories(customizations)) {
    const productivity = customizations[category]?.productivity;
    if (productivity) result[category] = productivity;
  }
  return result;
}

/** Each deleted category with the time it was deleted, for classification options. */
export function deletedCategoryCutoffs(customizations: CategoryCustomizations): Readonly<Partial<Record<ActivityCategory, string>>> {
  const result: Partial<Record<ActivityCategory, string>> = {};
  for (const category of definedCategories(customizations)) {
    const deletedAt = customizations[category]?.deletedAt;
    if (deletedAt) result[category] = deletedAt;
  }
  return result;
}

/** Deleted categories, which the classifier is no longer offered. */
export function deletedCategories(customizations: CategoryCustomizations): ActivityCategory[] {
  return definedCategories(customizations).filter((category) => Boolean(customizations[category]?.deletedAt));
}

export function categoryNameOverrides(customizations: CategoryCustomizations): Readonly<Partial<Record<ActivityCategory, string>>> {
  const result: Partial<Record<ActivityCategory, string>> = {};
  for (const category of definedCategories(customizations)) {
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
  /** An added level's color and creation time (its order). Deleting a level removes it. */
  readonly color?: string;
  readonly createdAt?: string;
}

export type ProductivityCustomizations = Readonly<Partial<Record<ProductivityLabel | CustomProductivityLevel, ProductivityCustomization>>>;

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

/**
 * An added level needs a name; its color and creation time come along. It
 * has no description: the classifier picks only focus, neutral, or drift, and
 * a level holds the categories fixed to it.
 */
export function normalizeProductivityLevelCustomization(value: unknown): ProductivityCustomization | null {
  const entry = normalizeProductivityCustomization(value);
  if (!entry?.name) return null;
  const record = value as Record<string, unknown>;
  const color = typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color) ? record.color.toLowerCase() : null;
  const createdAt = isoTime(record.createdAt);
  return { name: entry.name, ...(color ? { color } : {}), ...(createdAt ? { createdAt } : {}) };
}

export function normalizeProductivityCustomizations(value: unknown): ProductivityCustomizations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Partial<Record<ProductivityLabel | CustomProductivityLevel, ProductivityCustomization>> = {};
  for (const label of CUSTOMIZABLE_PRODUCTIVITY_LABELS) {
    const entry = normalizeProductivityCustomization(record[label]);
    if (entry) result[label] = entry;
  }
  // At most three added levels, the oldest first.
  const levels = Object.keys(record)
    .filter(isCustomProductivityLevel)
    .flatMap((key) => {
      const entry = normalizeProductivityLevelCustomization(record[key]);
      return entry ? [[key, entry] as const] : [];
    })
    .sort(([leftKey, left], [rightKey, right]) => (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || leftKey.localeCompare(rightKey))
    .slice(0, MAX_ADDED_PRODUCTIVITY_LEVELS);
  for (const [key, entry] of levels) result[key] = entry;
  return result;
}

/** The added levels' ids in the order they were made. */
export function productivityLevelIds(productivity: ProductivityCustomizations): CustomProductivityLevel[] {
  return (Object.keys(productivity).filter(isCustomProductivityLevel) as CustomProductivityLevel[])
    .sort((left, right) => (productivity[left]?.createdAt ?? "").localeCompare(productivity[right]?.createdAt ?? "") || left.localeCompare(right));
}

/** An added productivity level as the app draws it, with the live categories fixed to it. */
export interface ProductivityLevel {
  readonly id: CustomProductivityLevel;
  readonly name: string;
  readonly color: string;
  readonly categories: readonly ActivityCategory[];
}

/**
 * The added levels in the order they were made, each with the live
 * categories fixed to it. A level is display only: its time is the neutral
 * time of those categories.
 */
export function productivityLevels(productivity: ProductivityCustomizations, categories: CategoryCustomizations): ProductivityLevel[] {
  return productivityLevelIds(productivity).map((id) => ({
    id,
    name: productivity[id]?.name ?? "",
    color: productivity[id]?.color ?? "#9b968b",
    categories: definedCategories(categories).filter((category) => categories[category]?.level === id && !categories[category]?.deletedAt),
  }));
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
