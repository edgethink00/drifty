// SVG → PNG export paths for the share card: clipboard copy, and native save
// dialog via the `share_card_save_png` Tauri command.

import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriRuntime, saveShareCardPng } from "../../lib/api/shareCardClient";

const MAX_SHARE_CARD_RASTER_PIXELS = 12_000_000;
const MAX_SHARE_CARD_PNG_BYTES = 20 * 1024 * 1024;

export function shareCardSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterize the (already export-sized) SVG string to a PNG blob. */
export async function rasterizeShareCardSvg(svg: string, width: number, height: number): Promise<Blob> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_SHARE_CARD_RASTER_PIXELS) {
    throw new Error("Share card export dimensions are unsupported.");
  }
  const image = new Image();
  image.decoding = "sync";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Share card SVG failed to load for export."));
  });
  image.src = shareCardSvgDataUrl(svg);
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable for share card export.");
  context.drawImage(image, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Share card PNG encoding failed."));
    }, "image/png");
  });
}

/**
 * Copy the card PNG to the system clipboard. Must be called from a user gesture;
 * WebKit requires the ClipboardItem to receive the blob as a promise created
 * synchronously within that gesture.
 */
export async function copyShareCardPng(svg: string, width: number, height: number): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Image clipboard is not available in this environment.");
  }
  const blobPromise = rasterizeShareCardSvg(svg, width, height);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (blob.size > MAX_SHARE_CARD_PNG_BYTES) {
    throw new Error("Share card image is unexpectedly large.");
  }
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export interface SaveShareCardResult {
  /** Absolute path after the user selects a destination; null when cancelled. */
  readonly path: string | null;
  readonly cancelled: boolean;
}

/** Open a trusted social composer in the default browser. */
export async function openShareComposer(url: string): Promise<void> {
  const parsed = new URL(url);
  const trusted = parsed.protocol === "https:"
    && (parsed.hostname === "www.linkedin.com" || parsed.hostname === "x.com");
  if (!trusted) throw new Error("Unsupported share destination.");

  if (isTauriRuntime()) {
    await openUrl(parsed.toString());
    return;
  }
  // With `noopener`, browsers may intentionally return null even when the tab
  // opened successfully. The platform's popup UI is the source of truth here.
  window.open(parsed.toString(), "_blank", "noopener,noreferrer");
}

/** Save the card PNG through the native macOS save panel. */
export async function saveShareCardWithDialog(
  svg: string,
  width: number,
  height: number,
  fileName: string,
): Promise<SaveShareCardResult> {
  const blob = await rasterizeShareCardSvg(svg, width, height);
  if (!isTauriRuntime()) {
    throw new Error("The native save panel is available in the Drifty desktop app.");
  }
  const path = await saveShareCardPng(fileName, await blobToBase64(blob));
  return { path, cancelled: path === null };
}
