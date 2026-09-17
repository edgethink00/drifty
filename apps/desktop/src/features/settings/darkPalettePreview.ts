export const DARK_PALETTE_PREVIEW_STORAGE_KEY = "drifty.dev.darkPalettePreview";

export const DARK_PALETTE_PREVIEW_OPTIONS = [
  {
    id: "current",
    label: "Default (V1)",
    detail: "Refined charcoal",
  },
  {
    id: "classic",
    label: "Classic",
    detail: "Deep black",
  },
  {
    id: "v21",
    label: "V2.1",
    detail: "Raised surfaces",
  },
] as const;

export type DarkPalettePreview = (typeof DARK_PALETTE_PREVIEW_OPTIONS)[number]["id"];

function resolveDarkPalettePreview(value: string | null): DarkPalettePreview {
  if (value === "v1") return "current";
  for (const option of DARK_PALETTE_PREVIEW_OPTIONS) {
    if (option.id === value) return option.id;
  }
  return "current";
}

export function resolveInitialDarkPalettePreview(): DarkPalettePreview {
  if (typeof window === "undefined") return "current";
  return resolveDarkPalettePreview(
    window.localStorage.getItem(DARK_PALETTE_PREVIEW_STORAGE_KEY),
  );
}

export function persistDarkPalettePreview(preview: DarkPalettePreview): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DARK_PALETTE_PREVIEW_STORAGE_KEY, preview);
}

export function applyDarkPalettePreview(
  root: HTMLElement,
  preview: DarkPalettePreview,
  enabled: boolean,
): void {
  if (!enabled || preview === "current") {
    delete root.dataset.darkPalettePreview;
    return;
  }
  root.dataset.darkPalettePreview = preview;
}

export function installDarkPalettePreviewStorageSync(
  targetWindow: Window,
  root: HTMLElement,
  devFeatureEnabled: boolean,
  devModeStorageKey: string,
): () => void {
  const sync = () => {
    try {
      const preview = resolveDarkPalettePreview(
        targetWindow.localStorage.getItem(DARK_PALETTE_PREVIEW_STORAGE_KEY),
      );
      const devModeActive = devFeatureEnabled
        && targetWindow.localStorage.getItem(devModeStorageKey) === "1";
      applyDarkPalettePreview(root, preview, devModeActive);
    } catch {
      applyDarkPalettePreview(root, "current", false);
    }
  };

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== null
      && event.key !== DARK_PALETTE_PREVIEW_STORAGE_KEY
      && event.key !== devModeStorageKey
    ) return;
    sync();
  };

  sync();
  targetWindow.addEventListener("storage", handleStorage);
  return () => targetWindow.removeEventListener("storage", handleStorage);
}
