// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPetModeImageHold } from "./petModeImageHold";

type Load = { readonly src: string; readonly crossOrigin: string | null };

function recordImages(decode: () => Promise<void> = () => Promise.resolve()) {
  const loads: Load[] = [];
  vi.stubGlobal("Image", class {
    crossOrigin: string | null = null;
    #src = "";
    get src() { return this.#src; }
    // Record the fetch mode in effect when the request starts.
    set src(value: string) { this.#src = value; loads.push({ src: value, crossOrigin: this.crossOrigin }); }
    decode() { return decode(); }
  });
  return loads;
}

describe("pet image hold", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps one preload per source and fetch mode, and fetches CSS masks in CORS mode", async () => {
    const loads = recordImages();
    const images = createPetModeImageHold();
    await images.hold("/pet-mode/paw/f001.png");
    await images.hold("/pet-mode/paw/f001.png");
    await images.hold("/pet-mode/siamese/paw/f001-a.png", "css-mask");
    await images.hold("/pet-mode/siamese/paw/f001-a.png", "css-mask");

    expect(loads).toEqual([
      { src: "/pet-mode/paw/f001.png", crossOrigin: null },
      { src: "/pet-mode/siamese/paw/f001-a.png", crossOrigin: "anonymous" },
    ]);
    expect(images.has("/pet-mode/paw/f001.png")).toBe(true);
    expect(images.has("/pet-mode/siamese/paw/f001-a.png", "css-mask")).toBe(true);
    // A no-cors entry cannot serve a CSS mask, so it is not the same preload.
    expect(images.has("/pet-mode/siamese/paw/f001-a.png")).toBe(false);
  });

  it("does not keep a failed load, so the next preload fetches it again", async () => {
    let fail = true;
    const loads = recordImages(() => (fail ? Promise.reject(new Error("decode failed")) : Promise.resolve()));
    const images = createPetModeImageHold();

    await expect(images.hold("/pet-mode/run/f001.png")).rejects.toThrow("decode failed");
    expect(images.has("/pet-mode/run/f001.png")).toBe(false);
    fail = false;
    await images.hold("/pet-mode/run/f001.png");

    expect(loads).toHaveLength(2);
    expect(images.has("/pet-mode/run/f001.png")).toBe(true);
  });
});
