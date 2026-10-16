import { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_ORDER,
  categoryNameOverrides,
  categoryProductivityPreferences,
  customCategoryIds,
  deletedCategories,
  productivityLevels,
  type ProductivityLevel,
  deletedCategoryCutoffs,
  productivityNameOverrides,
  type ActivityCategory,
  type CategoryCustomizations,
  type CategoryProductivityPreferences,
  type ProductivityCustomizations,
} from "@drifty/domain";
import {
  CATEGORY_CUSTOMIZATION_CHANGED_EVENT,
  CATEGORY_CUSTOMIZATION_STORAGE_KEY,
  PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY,
  readCategoryCustomizations,
  readProductivityCustomizations,
} from "./settingsStorage";
import { customCategoryStyleSheet } from "../../lib/customCategoryStyles";

/**
 * Live view of one stored definition map. The saving window hears the change
 * event; the main window and auxiliary windows share localStorage, so the
 * others hear the storage event.
 */
function useStoredDefinitions<T>(storageKey: string, read: () => T): T {
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const update = () => setValue(read());
    const updateFromStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) update();
    };
    window.addEventListener(CATEGORY_CUSTOMIZATION_CHANGED_EVENT, update);
    window.addEventListener("storage", updateFromStorage);
    return () => {
      window.removeEventListener(CATEGORY_CUSTOMIZATION_CHANGED_EVENT, update);
      window.removeEventListener("storage", updateFromStorage);
    };
  }, [storageKey, read]);
  return value;
}

export function useCategoryCustomizations(): CategoryCustomizations {
  return useStoredDefinitions(CATEGORY_CUSTOMIZATION_STORAGE_KEY, readCategoryCustomizations);
}

export function useProductivityCustomizations(): ProductivityCustomizations {
  return useStoredDefinitions(PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY, readProductivityCustomizations);
}

/** For publishers that build their own classification options outside React state. */
export function readCategoryProductivityPreferences(): CategoryProductivityPreferences {
  return categoryProductivityPreferences(readCategoryCustomizations());
}

/** Deleted categories with their deletion time, for publishers outside React state. */
export function readDeletedCategoryCutoffs(): ReturnType<typeof deletedCategoryCutoffs> {
  return deletedCategoryCutoffs(readCategoryCustomizations());
}

/**
 * Identity of the in-app label overrides: custom category names and custom
 * productivity names. The localization providers parse it back.
 */
export function useCategoryNameOverrideKey(): string {
  const categories = categoryNameOverrides(useCategoryCustomizations());
  const productivity = productivityNameOverrides(useProductivityCustomizations());
  return JSON.stringify({ categories, productivity });
}


/**
 * The categories a picker can offer, in display order: the built-in ones,
 * then the ones the user added, then Unclassified. Deleted ones are still in
 * it; pickers leave them out except as an item's current value.
 */
export function useCategoryChoices(): readonly ActivityCategory[] {
  const customizations = useCategoryCustomizations();
  return useMemo(() => {
    const builtIn = CATEGORY_ORDER.filter((category) => category !== "unknown");
    return [...builtIn, ...customCategoryIds(customizations), "unknown"];
  }, [customizations]);
}

/**
 * Each added category's color: a CSS variable (--category-<id>), which
 * CATEGORY_COLORS points at, and the class rules the charts color by, so
 * every chart and dot in this window shows it.
 */
export function useCustomCategoryColorVariables(): void {
  const customizations = useCategoryCustomizations();
  useEffect(() => {
    const element = document.createElement("style");
    element.dataset.driftyCustomCategories = "";
    element.textContent = customCategoryStyleSheet(customizations);
    document.head.appendChild(element);
    return () => element.remove();
  }, [customizations]);
}

/** The live added productivity levels, each with the categories fixed to it. */
export function useProductivityLevels(): readonly ProductivityLevel[] {
  const categories = useCategoryCustomizations();
  const productivity = useProductivityCustomizations();
  return useMemo(() => productivityLevels(productivity, categories), [categories, productivity]);
}

/** Each added level's color on the classes the charts color productivity by. */
export function useProductivityLevelStyles(): void {
  const levels = useProductivityLevels();
  useEffect(() => {
    if (levels.length === 0) return undefined;
    const element = document.createElement("style");
    element.dataset.driftyProductivityLevels = "";
    element.textContent = levels
      .map((level) => ".flow-cell--" + level.id + ", .productivity-dot--" + level.id + " { background: " + level.color + "; }")
      .join("\n");
    document.head.appendChild(element);
    return () => element.remove();
  }, [levels]);
}

/** Categories the user deleted. Pickers leave them out, except an item's current value. */
export function useDeletedCategories(): ReadonlySet<ActivityCategory> {
  const customizations = useCategoryCustomizations();
  return useMemo(() => new Set(deletedCategories(customizations)), [customizations]);
}
