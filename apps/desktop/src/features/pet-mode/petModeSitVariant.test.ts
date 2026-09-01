// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_PRODUCTION_SIT_ARTWORK,
  PET_MODE_SIT_VARIANT_STORAGE_KEY,
  resolvePetModeSitArtworkId,
  resolvePetModeSitVariantSelection,
} from "./petModeSitVariant";

describe("pet sit production promotion switch", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses the reviewed live D artwork as the current production default", () => {
    expect(PET_MODE_PRODUCTION_SIT_ARTWORK).toBe("d-lifted-tail-live");
    expect(resolvePetModeSitVariantSelection()).toBe("production");
    expect(resolvePetModeSitArtworkId()).toBe("d-lifted-tail-live");
  });

  it("makes the durable production sentinel follow the configured artwork", () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "production");
    const selection = resolvePetModeSitVariantSelection();
    expect(selection).toBe("production");
    expect(resolvePetModeSitArtworkId(selection, "shipped")).toBe("shipped");
  });

  it("keeps an explicit Dev fallback independent of the production switch", () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "shipped");
    const selection = resolvePetModeSitVariantSelection();
    expect(selection).toBe("shipped");
    expect(resolvePetModeSitArtworkId(selection, "d-lifted-tail-live")).toBe("shipped");
  });

  it("fails unknown or unavailable stored values back to the production sentinel", () => {
    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, "future-pose");
    expect(resolvePetModeSitVariantSelection()).toBe("production");
    expect(resolvePetModeSitArtworkId()).toBe("d-lifted-tail-live");
  });
});
