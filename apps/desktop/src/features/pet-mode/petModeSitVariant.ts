/**
 * The one production promotion switch for Pet Mode's resting sit artwork.
 *
 * D is the reviewed production default. Every caller, gaze anchor, preload,
 * and hit region resolves through this value unless Dev mode has an explicit
 * override; `shipped` remains available as the explicit fallback.
 */
export type PetModeSitArtworkId =
  | "shipped"
  | "d-lifted-tail-live"
  | "d-lifted-tail"
  | "e-clean-front"
  | "b-low-rise";

export type PetModeSitVariantSelectionId = "production" | PetModeSitArtworkId;

export const PET_MODE_PRODUCTION_SIT_ARTWORK: PetModeSitArtworkId = "d-lifted-tail-live";
export const PET_MODE_SIT_VARIANT_STORAGE_KEY = "drifty.dev.petSitVariant";

const PET_MODE_SIT_ARTWORK_IDS: readonly PetModeSitArtworkId[] = [
  "shipped",
  "d-lifted-tail-live",
  "d-lifted-tail",
  "e-clean-front",
  "b-low-rise",
] as const;

const PET_MODE_SIT_ARTWORK_LABELS: Readonly<Record<PetModeSitArtworkId, string>> = {
  shipped: "Shipped vector",
  "d-lifted-tail-live": "D — Lifted Tail (live)",
  "d-lifted-tail": "D — Lifted Tail (exact reference)",
  "e-clean-front": "E — Clean Front (exact reference)",
  "b-low-rise": "B — Low Rise (exact reference)",
};

export const PET_MODE_SIT_VARIANT_OPTIONS: readonly {
  readonly id: PetModeSitVariantSelectionId;
  readonly label: string;
}[] = [
  {
    id: "production",
    label: `Production default — ${PET_MODE_SIT_ARTWORK_LABELS[PET_MODE_PRODUCTION_SIT_ARTWORK]}`,
  },
  { id: "d-lifted-tail-live", label: "D — Lifted Tail (live)" },
  { id: "shipped", label: "Shipped vector (fallback)" },
  { id: "d-lifted-tail", label: PET_MODE_SIT_ARTWORK_LABELS["d-lifted-tail"] },
  { id: "e-clean-front", label: PET_MODE_SIT_ARTWORK_LABELS["e-clean-front"] },
  { id: "b-low-rise", label: PET_MODE_SIT_ARTWORK_LABELS["b-low-rise"] },
] as const;

function isPetModeSitArtworkId(value: string): value is PetModeSitArtworkId {
  return PET_MODE_SIT_ARTWORK_IDS.includes(value as PetModeSitArtworkId);
}

function readStoredPetModeSitSelection(): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(PET_MODE_SIT_VARIANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Returns the Dev UI selection. `production` is a durable follow-default sentinel. */
export function resolvePetModeSitVariantSelection(
  stored: string | null = readStoredPetModeSitSelection(),
): PetModeSitVariantSelectionId {
  if (stored === "production" || stored === null) return "production";
  return isPetModeSitArtworkId(stored) ? stored : "production";
}

/**
 * Resolves the effective artwork. Supplying `productionArtwork` makes the
 * promotion behavior directly testable without mutating the real switch.
 */
export function resolvePetModeSitArtworkId(
  selection: PetModeSitVariantSelectionId = resolvePetModeSitVariantSelection(),
  productionArtwork: PetModeSitArtworkId = PET_MODE_PRODUCTION_SIT_ARTWORK,
): PetModeSitArtworkId {
  return selection === "production" ? productionArtwork : selection;
}
