/** Only trim excessive transparent padding; never stretch or recolor a logo. */
export function paddedIconCrop(width: number, height: number, rgba: Uint8ClampedArray): { x: number; y: number; width: number; height: number } | null {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) return null;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return null;
  const visibleSide = Math.max(right - left + 1, bottom - top + 1);
  const imageSide = Math.max(width, height);
  if (visibleSide >= imageSide * 0.8) return null;
  // Leave breathing room, including every nonzero-alpha shadow pixel. Cap
  // magnification at 4x so a tiny mark cannot balloon into an oversized logo.
  const side = Math.max(visibleSide / 0.88, imageSide / 4);
  return { x: (left + right + 1 - side) / 2, y: (top + bottom + 1 - side) / 2, width: side, height: side };
}

const cache = new Map<string, Promise<string>>();

export function calibratedAppIcon(source: string): Promise<string> {
  // Icons are local PNG data URLs. Do not decode remote, SVG, or arbitrary URLs.
  if (!source.startsWith("data:image/png;base64,") || source.length > 6 * 1024 * 1024) return Promise.resolve(source);
  const existing = cache.get(source);
  if (existing) return existing;
  const result = renderIcon(source).catch(() => source);
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(source, result);
  return result;
}

async function renderIcon(source: string): Promise<string> {
  const image = new Image();
  image.src = source;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) return source;
  // Bound analysis cost even when the package supplies a large store logo.
  const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(image.naturalWidth * scale));
  sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(image, 0, 0, sample.width, sample.height);
  const crop = paddedIconCrop(sample.width, sample.height, context.getImageData(0, 0, sample.width, sample.height).data);
  if (!crop) return source;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const output = canvas.getContext("2d");
  if (!output) return source;
  output.imageSmoothingQuality = "high";
  // Draw the original pixels, not the analysis thumbnail. A square source
  // region preserves proportions and transparent margins for non-square art.
  const sourceScaleX = image.naturalWidth / sample.width;
  const sourceScaleY = image.naturalHeight / sample.height;
  const sourceSide = Math.max(crop.width * sourceScaleX, crop.height * sourceScaleY);
  const centerX = (crop.x + crop.width / 2) * sourceScaleX;
  const centerY = (crop.y + crop.height / 2) * sourceScaleY;
  output.drawImage(image, centerX - sourceSide / 2, centerY - sourceSide / 2,
    sourceSide, sourceSide, 0, 0, 128, 128);
  return canvas.toDataURL("image/png");
}
