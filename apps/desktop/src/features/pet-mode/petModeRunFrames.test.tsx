// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { PetModeCat } from "./PetModeCat";
import {
  PET_MODE_PAW_ARRIVAL_OFFSET_X_PX,
  PET_MODE_PAW_GROUND_OFFSET_Y_PX,
  PET_MODE_PAW_PREP_DURATION_MS,
  PET_MODE_RUN_FRAME_COUNT,
} from "./petModeData";
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

  it("wraps frame paths and renders the authored run by default", () => {
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
      <PetModeCat phase="run" facing="right" pawFrame={0} frameOverride={26} decorative />,
    );
    const cat = view.container.querySelector(".pet-mode-cat")!;
    const run = cat.querySelector<HTMLImageElement>(".pet-mode-cat__raster--run");
    expect(cat.getAttribute("data-region-id")).toBe("run-gait:9");
    expect(run?.getAttribute("src")).toBe("/pet-mode/run/f010.png");
    expect((cat as HTMLElement).style.getPropertyValue("--pet-chase-lean")).toBe("0deg");
  });

  it("keeps the existing fast vector gait for an explicit opt-out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L150 0 L150 120 Z"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });

    const view = render(
      <PetModeCat phase="run" facing="right" pawFrame={0} fastRunEnabled={false} frameOverride={0} publishHitRegion={false} />,
    );

    await waitFor(() => expect(view.container.querySelector(".pet-mode-cat__vector")).not.toBeNull());
    const cat = view.container.querySelector(".pet-mode-cat")!;
    expect(cat.getAttribute("data-region-id")).toBe("gait:0");
    expect(cat.querySelector(".pet-mode-cat__raster--run")).toBeNull();
    expect((cat as HTMLElement).style.getPropertyValue("--pet-chase-lean")).not.toBe("0deg");
  });

  it("keeps the vector gait visible until every run frame is decoded", async () => {
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
        fastRunEnabled
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

  it("settles the fast-run landing into the first paw frames without an opacity blend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L150 0 L150 120 Z"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    const view = render(
      <PetModeCat
        phase="run"
        facing="right"
        pawFrame={0}
        fastRunEnabled
        frameOverride={6}
        publishHitRegion={false}
      />,
    );
    await waitFor(() => expect(view.container.querySelector(".pet-mode-cat__raster--run")).not.toBeNull());

    view.rerender(
      <PetModeCat
        phase="paw"
        facing="right"
        pawFrame={0}
        fastRunEnabled
        fastRunPawArrival
        publishHitRegion={false}
      />,
    );
    const cat = view.container.querySelector<HTMLElement>(".pet-mode-cat")!;
    expect(cat.classList.contains("is-fast-run-paw-grounded")).toBe(true);
    expect(cat.classList.contains("is-fast-run-paw-arrival")).toBe(true);
    expect(cat.style.getPropertyValue("--pet-paw-arrival-duration")).toBe(`${PET_MODE_PAW_PREP_DURATION_MS}ms`);
    expect(cat.style.getPropertyValue("--pet-paw-arrival-x")).toBe(`${PET_MODE_PAW_ARRIVAL_OFFSET_X_PX}px`);
    expect(cat.style.getPropertyValue("--pet-paw-ground-offset-y")).toBe(`${PET_MODE_PAW_GROUND_OFFSET_Y_PX}px`);
    expect(petModeCss).toContain("@keyframes pet-mode-paw-arrival-bridge");
    const bridgeRuleStart = petModeCss.indexOf(
      ".pet-mode-cat.is-fast-run-paw-arrival .pet-mode-cat__raster--paw",
    );
    const bridgeRule = petModeCss.slice(bridgeRuleStart, petModeCss.indexOf("}", bridgeRuleStart) + 1);
    expect(bridgeRule).toContain("animation: pet-mode-paw-arrival-bridge");
    expect(bridgeRule).not.toContain("opacity");

    view.rerender(
      <PetModeCat
        phase="paw"
        facing="right"
        pawFrame={7}
        fastRunEnabled
        fastRunPawArrival
        publishHitRegion={false}
      />,
    );
    expect(cat.classList.contains("is-fast-run-paw-arrival")).toBe(false);
    expect(cat.classList.contains("is-fast-run-paw-grounded")).toBe(true);
    expect(cat.getAttribute("data-region-id")).toBe("paw-grounded:7");
  });

  it("keeps the fast-run legs cycling when the system asks for reduced motion", async () => {
    // Native always travels to the close target now, so a renderer that held
    // frame 0 under reduced motion would slide a frozen cat across the screen.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L150 0 L150 120 Z"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    // Drive animation timestamps rather than depending on jsdom's wall-clock
    // rAF delivery while the shared CI runner is busy.
    let nextAnimationId = 0;
    const animationFrames = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextAnimationId;
      animationFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      animationFrames.delete(id);
    });
    const advanceFrame = (timestamp: number) => act(() => {
      expect(animationFrames.size).toBeGreaterThan(0);
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      pending.forEach((callback) => callback(timestamp));
    });

    const view = render(
      <PetModeCat phase="run" facing="right" pawFrame={0} fastRunEnabled publishHitRegion={false} />,
    );
    await waitFor(() => expect(view.container.querySelector(".pet-mode-cat__raster--run")).not.toBeNull());
    const firstFrame = getPetModeRunFrameSource(0);
    expect(view.container.querySelector(".pet-mode-cat__raster--run")?.getAttribute("src")).toBe(firstFrame);

    advanceFrame(50);
    expect(view.container.querySelector(".pet-mode-cat__raster--run")?.getAttribute("src"))
      .toBe(getPetModeRunFrameSource(1));
    advanceFrame(100);
    expect(view.container.querySelector(".pet-mode-cat__raster--run")?.getAttribute("src"))
      .toBe(getPetModeRunFrameSource(2));
  });

  it("falls back to the vector gait when default run frame decoding fails", async () => {
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
