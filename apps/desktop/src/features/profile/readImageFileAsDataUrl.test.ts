import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_MAX_OUTPUT_BYTES, readImageFileAsDataUrl } from "./ProfileModals";

// The vitest environment is "node", so the DOM APIs the resizer relies on are stubbed here.
type CanvasStub = {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toDataURL: ReturnType<typeof vi.fn>;
};

const originalCreateImageBitmap = (globalThis as Record<string, unknown>).createImageBitmap;
const originalDocument = (globalThis as Record<string, unknown>).document;

let drawImageMock: ReturnType<typeof vi.fn>;
let canvas: CanvasStub;
let bitmapClose: ReturnType<typeof vi.fn>;

function installStubs(toDataUrlResults: string[]) {
  drawImageMock = vi.fn();
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: drawImageMock };
  let call = 0;
  canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => toDataUrlResults[Math.min(call++, toDataUrlResults.length - 1)]),
  };
  (globalThis as Record<string, unknown>).document = {
    createElement: vi.fn(() => canvas),
  };
  bitmapClose = vi.fn();
  (globalThis as Record<string, unknown>).createImageBitmap = vi.fn(async () => ({
    width: 4000,
    height: 3000,
    close: bitmapClose,
  }));
}

beforeEach(() => {
  installStubs([`data:image/jpeg;base64,${"A".repeat(2000)}`]);
});

afterEach(() => {
  (globalThis as Record<string, unknown>).createImageBitmap = originalCreateImageBitmap;
  (globalThis as Record<string, unknown>).document = originalDocument;
  vi.restoreAllMocks();
});

describe("readImageFileAsDataUrl", () => {
  it("downsizes to a 256px JPEG with a centered square crop", async () => {
    const result = await readImageFileAsDataUrl({} as File);

    expect(result.startsWith("data:image/jpeg")).toBe(true);
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.82);

    // 4000x3000 source -> 3000 square crop centered (x offset 500, y offset 0) scaled into 256.
    expect(drawImageMock).toHaveBeenCalledWith(expect.anything(), 500, 0, 3000, 3000, 0, 0, 256, 256);
    expect(bitmapClose).toHaveBeenCalled();
  });

  it("retries smaller when the first encode is still too large", async () => {
    const big = `data:image/jpeg;base64,${"A".repeat(AVATAR_MAX_OUTPUT_BYTES)}`;
    const small = `data:image/jpeg;base64,${"A".repeat(1000)}`;
    installStubs([big, small]);

    const result = await readImageFileAsDataUrl({} as File);

    expect(result).toBe(small);
    expect(canvas.toDataURL).toHaveBeenNthCalledWith(2, "image/jpeg", 0.7);
  });

  it("rejects when the image cannot be compressed under the size guard", async () => {
    const big = `data:image/jpeg;base64,${"A".repeat(AVATAR_MAX_OUTPUT_BYTES)}`;
    installStubs([big, big]);

    await expect(readImageFileAsDataUrl({} as File)).rejects.toThrow(/too detailed/i);
  });
});
