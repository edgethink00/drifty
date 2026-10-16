import { useCallback } from "react";
import {
  isCustomActivityCategory,
  normalizeCategoryCustomization,
  normalizeCustomCategoryCustomization,
  isCustomProductivityLevel,
  normalizeProductivityCustomization,
  normalizeProductivityLevelCustomization,
  type ActivityCategory,
  type CustomProductivityLevel,
  type CategoryCustomization,
  type CategoryCustomizations,
  type ProductivityCustomization,
  type ProductivityCustomizations,
  type ProductivityLabel,
} from "@drifty/domain";
import { useCategoryCustomizations, useProductivityCustomizations } from "./categoryCustomizationStore";
import { writeCategoryCustomizations, writeProductivityCustomizations } from "./settingsStorage";

/** One save from the category editor. Omitted keys stay as they are; null restores the built-in definition. */
export type DefinitionChanges = {
  readonly categories?: Readonly<Partial<Record<ActivityCategory, CategoryCustomization | null>>>;
  /** Built-in labels and added levels; null removes an added level. */
  readonly productivity?: Readonly<Partial<Record<ProductivityLabel | CustomProductivityLevel, ProductivityCustomization | null>>>;
};

export type CategoryCustomizationController = {
  readonly customizations: CategoryCustomizations;
  readonly productivityCustomizations: ProductivityCustomizations;
  /** Saves every changed definition at once. */
  readonly saveDefinitions: (changes: DefinitionChanges) => Promise<void>;
};

/**
 * Saves category and productivity definitions. A changed description applies
 * to activity classified from then on; saving never reclassifies past activity,
 * so it spends no model calls.
 */
export function useCategoryCustomizationController(): CategoryCustomizationController {
  const customizations = useCategoryCustomizations();
  const productivityCustomizations = useProductivityCustomizations();

  const saveDefinitions = useCallback(async (changes: DefinitionChanges) => {
    const categoryEntries = Object.entries(changes.categories ?? {}) as [ActivityCategory, CategoryCustomization | null][];
    const productivityEntries = Object.entries(changes.productivity ?? {}) as [ProductivityLabel | CustomProductivityLevel, ProductivityCustomization | null][];
    if (categoryEntries.length > 0) {
      const merged: Partial<Record<ActivityCategory, CategoryCustomization>> = { ...customizations };
      for (const [category, next] of categoryEntries) {
        // An added category keeps its color and creation time with its words.
        const normalized = next
          ? isCustomActivityCategory(category) ? normalizeCustomCategoryCustomization(next) : normalizeCategoryCustomization(next)
          : null;
        if (normalized) merged[category] = normalized;
        else delete merged[category];
      }
      writeCategoryCustomizations(merged);
    }
    if (productivityEntries.length > 0) {
      const merged: Partial<Record<ProductivityLabel | CustomProductivityLevel, ProductivityCustomization>> = { ...productivityCustomizations };
      for (const [label, next] of productivityEntries) {
        // An added level keeps its name, color, and creation time.
        const normalized = next
          ? isCustomProductivityLevel(label) ? normalizeProductivityLevelCustomization(next) : normalizeProductivityCustomization(next)
          : null;
        if (normalized) merged[label] = normalized;
        else delete merged[label];
      }
      writeProductivityCustomizations(merged);
    }
  }, [customizations, productivityCustomizations]);

  return { customizations, productivityCustomizations, saveDefinitions };
}

