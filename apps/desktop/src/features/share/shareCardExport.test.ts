// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rasterizeShareCardSvg } from "./shareCardExport";

describe("share card export safeguards", () => {
  it("rejects invalid raster dimensions before allocating a canvas", async () => {
    await expect(rasterizeShareCardSvg("<svg />", 0, 900)).rejects.toThrow("dimensions are unsupported");
    await expect(rasterizeShareCardSvg("<svg />", 12_001, 1_000)).rejects.toThrow("dimensions are unsupported");
  });
});
