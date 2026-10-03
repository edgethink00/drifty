import { afterEach, describe, expect, it, vi } from "vitest";
import { calibratedAppIcon } from "./appIconPresentation";

afterEach(() => vi.unstubAllGlobals());

describe("app icon rendering safeguards", () => {
  it("keeps nonlocal and oversized sources out of the decoder", async () => {
    const image = vi.fn();
    vi.stubGlobal("Image", image);
    for (const source of ["https://example.com/icon.png", "data:image/svg+xml,<svg/>", `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}`]) {
      expect(await calibratedAppIcon(source)).toBe(source);
    }
    expect(image).not.toHaveBeenCalled();
  });

  it("shares a concurrent decode and retains the original when decoding fails", async () => {
    const decode = vi.fn().mockRejectedValue(new Error("invalid PNG"));
    vi.stubGlobal("Image", class { src = ""; decode = decode; });
    const source = "data:image/png;base64,invalid-render-test";
    const first = calibratedAppIcon(source);
    const second = calibratedAppIcon(source);
    expect(second).toBe(first);
    expect(await first).toBe(source);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("preserves original proportions despite rounded analysis dimensions", async () => {
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = 513;
      naturalHeight = 257;
      decode = async () => {};
    });
    const data = new Uint8ClampedArray(256 * 128 * 4);
    data[(40 * 256 + 80) * 4 + 3] = 255;
    data[(70 * 256 + 120) * 4 + 3] = 255;
    const draw = vi.fn();
    const analysis = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data }) }) };
    const output = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toDataURL: () => "derived-png" };
    vi.stubGlobal("document", { createElement: vi.fn().mockReturnValueOnce(analysis).mockReturnValueOnce(output) });
    expect(await calibratedAppIcon("data:image/png;base64,rectangular-render-test")).toBe("derived-png");
    const args = draw.mock.calls[0];
    expect(args[3]).toBe(args[4]);
    expect(args[5]).toBe(0);
    expect(args[6]).toBe(0);
    expect(args[7]).toBe(128);
    expect(args[8]).toBe(128);
  });
});
