import { isBrowserExtensionId } from "@drifty/domain";

/**
 * The place a memory came from, written "App / site". A browser extension page
 * records its 32-letter id as the site, so that part reads as the extension
 * label instead ("Aside / browser extension").
 */
export function memoryPlaceLabel(place: string, extensionLabel: string): string {
  const split = place.lastIndexOf(" / ");
  if (split < 0) return place;
  return isBrowserExtensionId(place.slice(split + 3)) ? place.slice(0, split + 3) + extensionLabel : place;
}
