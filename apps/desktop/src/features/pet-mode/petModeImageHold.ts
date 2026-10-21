/*
 * Pet frames swap on a clock, so every bitmap a swap can show has to be in the
 * WebView's memory cache when that swap paints. Tauri serves app assets with
 * no HTTP cache validators, so anything missing from that cache is fetched
 * again and the swap paints without it. A plain `new Image()` preload is not
 * enough, for two reasons:
 *
 * - Nothing references it once the effect returns, so a garbage collection
 *   can drop it. A layer mounted later then paints empty until the refetch
 *   lands: a frame with no cat at all.
 * - CSS `mask-image` fetches in CORS mode while `<img>` and `new Image()`
 *   fetch in no-cors mode, and the cache does not reuse an entry across those
 *   modes. A no-cors preload never serves a mask, so each frame swap waits on
 *   a fresh mask fetch and the masked layer paints fully transparent
 *   meanwhile: a pattern skin shows as a plain white cat.
 *
 * A hold keeps each preload referenced for as long as its owner lives and
 * fetches it in the mode of the layer that will show it.
 */

/** `element`: `<img>` or SVG `<image>` (no-cors). `css-mask`: CSS `mask-image` (CORS). */
export type PetModeImageFetchMode = "element" | "css-mask";

export type PetModeImageHold = {
  /** Starts a preload once and keeps it; resolves when it has decoded. */
  readonly hold: (source: string, mode?: PetModeImageFetchMode) => Promise<void>;
  readonly has: (source: string, mode?: PetModeImageFetchMode) => boolean;
};

export function createPetModeImageHold(): PetModeImageHold {
  const held = new Map<string, { readonly image: HTMLImageElement; readonly decoded: Promise<void> }>();
  const keyOf = (source: string, mode: PetModeImageFetchMode) => `${mode} ${source}`;
  return {
    hold(source, mode = "element") {
      const key = keyOf(source, mode);
      const existing = held.get(key);
      if (existing) return existing.decoded;
      const image = new Image();
      // Set before src: changing the mode afterwards would start a second fetch.
      if (mode === "css-mask") image.crossOrigin = "anonymous";
      image.src = source;
      const decoded = (image.decode?.() ?? Promise.resolve()).catch((error: unknown) => {
        // Do not keep a failed load, so a later preload can fetch it again.
        if (held.get(key)?.image === image) held.delete(key);
        throw error;
      });
      held.set(key, { image, decoded });
      return decoded;
    },
    has: (source, mode = "element") => held.has(keyOf(source, mode)),
  };
}
