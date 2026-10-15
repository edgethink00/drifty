import { useEffect, useState } from "react";
import {
  categoryNameOverrides,
  categoryProductivityPreferences,
  productivityNameOverrides,
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

/**
 * Identity of the in-app label overrides: custom category names and custom
 * productivity names. The localization providers parse it back.
 */
export function useCategoryNameOverrideKey(): string {
  const categories = categoryNameOverrides(useCategoryCustomizations());
  const productivity = productivityNameOverrides(useProductivityCustomizations());
  return JSON.stringify({ categories, productivity });
}
