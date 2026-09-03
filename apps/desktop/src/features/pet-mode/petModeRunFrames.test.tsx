// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { PetModeCat } from "./PetModeCat";
import { PET_MODE_RUN_FRAME_COUNT } from "./petModeData";
import { getPetModeRunFrameSource } from "./petModeRunFrames";

const petModeCss = readFileSync("src/features/pet-mode/petMode.css", "utf8");

describe("pet mode run frames", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ships one normalized RGBA frame pack on the native panel canvas", () => {
    const frameFiles = readdirSync("public/pet-mode/run")
      .filter((file) => /^f\d{3}\.png$/.test(file))
      .sort();
    expect(frameFiles).toHaveLength(PET_MODE_RUN_FRAME_COUNT);
    expect(frameFiles[0]).toBe("f001.png");
    expect(frameFiles[frameFiles.length - 1]).toBe("f017.png");

    for (const file of frameFiles) {
      const png = readFileSync(`public/pet-mode/run/${file}`);
      expect(png.subarray(1, 4).toString("ascii"), `${file} PNG signature`).toBe("PNG");
      expect(png.readUInt32BE(16), `${file} width`).toBe(144);
      expect(png.readUInt32BE(20), `${file} height`).toBe(99);
      expect(png[24], `${file} bit depth`).toBe(8);
      expect(png[25], `${file} RGBA color type`).toBe(6);
    }
  });

  it("normalizes the left-facing source to the app's unmirrored right-facing contract", () => {
    const ruleStart = petModeCss.indexOf(".pet-mode-cat__raster--run {");
    const rule = petModeCss.slice(ruleStart, petModeCss.indexOf("}", ruleStart) + 1);
    expect(ruleStart).toBeGreaterThan(-1);
    expect(rule).toContain("transform: scaleX(-1);");
    expect(petModeCss).toContain(".pet-mode-cat.is-mirrored { transform: scaleX(-1); }");
  });

  it("wraps frame paths and renders the authored run only when its beta is on", () => {
    expect(getPetModeRunFrameSource(0)).toBe("/pet-mode/run/f001.png");
    expect(getPetModeRunFrameSource(17)).toBe("/pet-mode/run/f001.png");
    expect(getPetModeRunFrameSource(-1)).toBe("/pet-mode/run/f017.png");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: [], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });

    const view = render(
      <PetModeCat phase="run" facing="right" pawFrame={0} fastRunBetaEnabled frameOverride={26} decorative />,
    );
    const cat = view.container.querySelector(".pet-mode-cat")!;
    const run = cat.querySelector<HTMLImageElement>(".pet-mode-cat__raster--run");
    expect(cat.getAttribute("data-region-id")).toBe("run-gait:9");
    expect(run?.getAttribute("src")).toBe("/pet-mode/run/f010.png");
    expect((cat as HTMLElement).style.getPropertyValue("--pet-chase-lean")).toBe("0deg");
  });

  it("keeps the existing fast vector gait as the default run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L150 0 L150 120 Z"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });

    const view = render(
      <PetModeCat phase="run" facing="right" pawFrame={0} frameOverride={0} publishHitRegion={false} />,
    );

    await waitFor(() => expect(view.container.querySelector(".pet-mode-cat__vector")).not.toBeNull());
    const cat = view.container.querySelector(".pet-mode-cat")!;
    expect(cat.getAttribute("data-region-id")).toBe("gait:0");
    expect(cat.querySelector(".pet-mode-cat__raster--run")).toBeNull();
    expect((cat as HTMLElement).style.getPropertyValue("--pet-chase-lean")).not.toBe("0deg");
  });

  it("keeps the vector gait visible until every beta frame is decoded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L150 0 L150 120 Z"], cycleSeconds: 1 }),
    }));
    let finishDecode!: () => void;
    const decodePending = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return decodePending; }
    });

    const view = render(
      <PetModeCat
        phase="run"
        facing="right"
        pawFrame={0}
        fastRunBetaEnabled
        frameOverride={0}
        publishHitRegion={false}
      />,
    );

    await waitFor(() => expect(view.container.querySelector(".pet-mode-cat__vector")).not.toBeNull());
    expect(view.container.querySelector(".pet-mode-cat__raster--run")).toBeNull();

    finishDecode();
    await waitFor(() => expect(view.container.querySelector(".pet-mode-cat__raster--run")).not.toBeNull());
    expect(view.container.querySelector(".pet-mode-cat__vector")).toBeNull();
  });

  it("falls back to the vector gait when beta frame decoding fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L150 0 L150 120 Z"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.reject(new Error("decode failed")); }
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const view = render(
      <PetModeCat
        phase="run"
        facing="right"
        pawFrame={0}
        fastRunBetaEnabled
        frameOverride={0}
        publishHitRegion={false}
      />,
    );

    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      "[pet-mode] run frames failed to preload; falling back to vector gait",
      expect.any(Error),
    ));
    expect(view.container.querySelector(".pet-mode-cat__vector")).not.toBeNull();
    expect(view.container.querySelector(".pet-mode-cat__raster--run")).toBeNull();
  });
});
