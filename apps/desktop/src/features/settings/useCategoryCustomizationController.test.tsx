// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATEGORY_CUSTOMIZATION_STORAGE_KEY, PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY, readCategoryCustomizations, readProductivityCustomizations } from "./settingsStorage";
import { useCategoryCustomizationController } from "./useCategoryCustomizationController";

describe("useCategoryCustomizationController", () => {
  const clearDefinitions = () => {
    window.localStorage.removeItem(CATEGORY_CUSTOMIZATION_STORAGE_KEY);
    window.localStorage.removeItem(PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY);
  };
  beforeEach(clearDefinitions);
  afterEach(clearDefinitions);

  it("saves several definitions of both kinds in one change, and null restores the built-in one", async () => {
    const hook = renderHook(() => useCategoryCustomizationController());
    await act(() => hook.result.current.saveDefinitions({ categories: { game: { name: "플레이" }, entertainment: { name: "쇼츠", productivity: "drift" } } }));

    await act(() => hook.result.current.saveDefinitions({
      categories: { learning: { description: "WWDC 세션" }, game: null },
      productivity: { drift: { description: "유튜브 쇼츠" } },
    }));

    expect(readCategoryCustomizations()).toEqual({ entertainment: { name: "쇼츠", productivity: "drift" }, learning: { description: "WWDC 세션" } });
    expect(readProductivityCustomizations()).toEqual({ drift: { description: "유튜브 쇼츠" } });
    expect(hook.result.current.customizations).toEqual(readCategoryCustomizations());
    expect(hook.result.current.productivityCustomizations).toEqual(readProductivityCustomizations());
  });

  it("leaves the other kind untouched when a save only changes one", async () => {
    const hook = renderHook(() => useCategoryCustomizationController());
    await act(() => hook.result.current.saveDefinitions({ productivity: { focus: { name: "몰입" } } }));

    await act(() => hook.result.current.saveDefinitions({ categories: { learning: { name: "개발 공부" } } }));

    expect(readProductivityCustomizations()).toEqual({ focus: { name: "몰입" } });
    expect(readCategoryCustomizations()).toEqual({ learning: { name: "개발 공부" } });
  });
});

