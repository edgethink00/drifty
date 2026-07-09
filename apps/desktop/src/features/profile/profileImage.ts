export const AVATAR_MAX_DIMENSION = 256;
export const AVATAR_JPEG_QUALITY = 0.82;
export const AVATAR_MAX_OUTPUT_BYTES = 100_000;

export async function readImageFileAsDataUrl(file: File): Promise<string> {
  const source = await decodeImageFile(file);
  try {
    let dataUrl = renderAvatarDataUrl(source, AVATAR_MAX_DIMENSION, AVATAR_JPEG_QUALITY);
    if (dataUrl.length > AVATAR_MAX_OUTPUT_BYTES) {
      dataUrl = renderAvatarDataUrl(source, 192, 0.7);
    }
    if (dataUrl.length > AVATAR_MAX_OUTPUT_BYTES) {
      throw new Error("Profile photo is too detailed to compress. Try a simpler image.");
    }
    return dataUrl;
  } finally {
    if (typeof (source as ImageBitmap).close === "function") {
      (source as ImageBitmap).close();
    }
  }
}

async function decodeImageFile(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
    }
  }
  return loadImageElement(file);
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read profile photo"));
    });
    image.src = objectUrl;
  });
}

function renderAvatarDataUrl(source: ImageBitmap | HTMLImageElement, size: number, quality: number): string {
  const sourceWidth = "naturalWidth" in source && source.naturalWidth ? source.naturalWidth : source.width;
  const sourceHeight = "naturalHeight" in source && source.naturalHeight ? source.naturalHeight : source.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Unable to read profile photo");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process profile photo");
  }

  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = (sourceWidth - cropSize) / 2;
  const cropY = (sourceHeight - cropSize) / 2;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.drawImage(source, cropX, cropY, cropSize, cropSize, 0, 0, size, size);

  return canvas.toDataURL("image/jpeg", quality);
}
