import { describe, expect, it } from "vitest";
import { normalizeClassificationTitles as normalize, type ClassificationTitleInput } from "./classificationTitles";

const page = (windowTitle: string, extra: Partial<ClassificationTitleInput> = {}): ClassificationTitleInput => ({
  appName: "Google Chrome", siteDomain: "example.com", title: "Document", windowTitle, ...extra,
});

describe("classification titles", () => {
  it.each([
    ["High memory usage", "800 MB"], ["메모리 사용량 많음", "1.2GB"],
    ["Hohe Arbeitsspeichernutzung", "1,2 GB"], ["高記憶體用量", "900 MB"],
    ["メモリを大量に使用", "900 MB"], ["Memoria utilizzata elevata", "900 MB"],
    ["Mức sử dụng bộ nhớ cao", "900 MB"], ["การใช้งานหน่วยความจำสูง", "900 MB"],
    ["Vysoké využitie pamäte", "900 MB"], ["Yüksek bellek kullanımı", "900 MB"],
  ])("removes corroborated %s without removing audio, a group or profile", (label, value) => {
    const input = page(`Document - Part of group Work - Audio playing - ${label} - ${value} - Google Chrome - Personal`);
    expect(normalize(input)).toEqual({ title: "Document", windowTitle: "Document - Part of group Work - Audio playing - Personal" });
    expect(input.windowTitle).toContain(value);
  });

  it.each(["Google Chrome Beta", "Google Chrome Canary", "Firefox Developer Edition", "Helium", "Aside", "NAVER Whale"])(
    "recognizes measured browser names including %s", (appName) => {
      expect(normalize(page("Document - High memory usage - 900 MB - Chrome", { appName })).windowTitle).toBe("Document");
    },
  );

  it.each(["and 2 more pages", "외 페이지 3개", "und 4 weitere Seiten", "et 2 autres pages", "y 3 páginas más", "e 2 altre pagine"])(
    "removes Edge %s only after the independent page title", (pages) => {
      expect(normalize(page(`Document ${pages} - Profile 1 - Microsoft\u200b Edge`, { appName: "Microsoft Edge" })).windowTitle)
        .toBe("Document - Profile 1");
    },
  );

  it("keeps a page count that belongs to the actual document title", () => {
    const title = "Document and 2 more pages";
    expect(normalize(page(`${title} - Microsoft Edge`, { appName: "Microsoft Edge", title })).windowTitle).toBe(title);
  });

  it("supports colon badges and preserves the content's own separators", () => {
    expect(normalize(page("Document – Part B: Uso elevado de memoria: 1.2 GB - Chrome - Personal", { title: "Document – Part B" })).windowTitle)
      .toBe("Document – Part B - Personal");
  });

  it("removes split-view placement while retaining microphone and tab-group context", () => {
    expect(normalize(page("Document - Right view - Part of group Research - Microphone recording - Chrome")).windowTitle)
      .toBe("Document - Part of group Research - Microphone recording");
  });

  it("removes an independent notification prefix and only measured platform-shell counters", () => {
    expect(normalize(page("(3) Document - Chrome")).windowTitle).toBe("Document");
    expect(normalize(page("(8) Instagram - Chrome", { title: "(3) Instagram", siteDomain: "instagram.com" })))
      .toEqual({ title: "Instagram", windowTitle: "Instagram" });
    const title = "(500) Days of Summer";
    expect(normalize(page(`${title} - Chrome`, { title, siteDomain: "youtube.com" })))
      .toEqual({ title, windowTitle: title });
    expect(normalize(page("(3) Instagram - Chrome", { title: "(3) Instagram", siteDomain: "example.com" })).title).toBe("(3) Instagram");
  });

  it.each([
    page("Document - High memory usage - 900 MB - Chrome", { title: null }),
    page("Another page - High memory usage - 900 MB - Chrome"),
    page("Documentary - High memory usage - 900 MB - Chrome"),
    page("Document - High memory usage - 900 MB - Unknown Browser"),
    page("Document - Chrome - Safari"),
    page("Document - High memory usage - 900 MB - Chrome", { appName: "Chrome 원격 데스크톱" }),
    page("Document - High memory usage - 900 MB - Chrome", { appName: "msedgewebview2" }),
  ])("leaves ambiguous or unsupported browser evidence intact", (input) => {
    expect(normalize(input).windowTitle).toBe(input.windowTitle);
  });

  it("does not erase real memory words, capacities or body punctuation", () => {
    for (const title of ["16 GB RAM recommendations", "How to debug - High memory usage - 800 MB", "Document – Volume 2", "(2026) Research"])
      expect(normalize(page(`${title} - Chrome`, { title })).windowTitle).toBe(title);
  });

  it("removes only the final editor zoom and preserves filename, layer, mode and unsaved marker", () => {
    const input = { appName: "Adobe Photoshop 2026", windowTitle: "Poster @ 100% (RGB/8).psd @ 50% (Layer 2, RGB/8) *" };
    expect(normalize(input).windowTitle).toBe("Poster @ 100% (RGB/8).psd (Layer 2, RGB/8) *");
    expect(normalize({ ...input, windowTitle: "Poster @ 100% (RGB/8).psd" }).windowTitle).toBe("Poster @ 100% (RGB/8).psd");
    const withZoomInName = normalize({ ...input, windowTitle: "Poster @ 100% (RGB/8) @ 50% (RGB/8)" });
    expect(withZoomInName.windowTitle).toBe("Poster @ 100% (RGB/8) (RGB/8)");
    expect(normalize({ ...input, ...withZoomInName })).toEqual(withZoomInName);
    expect(normalize({ ...input, appName: "Notes" }).windowTitle).toBe(input.windowTitle);
  });

  it("removes only measured mGBA FPS while preserving the game and emulator version", () => {
    expect(normalize({ appName: "mgba", windowTitle: "mGBA - HOMEBREW DEMO (120.3 fps) - 0.10.5" }).windowTitle)
      .toBe("mGBA - HOMEBREW DEMO - 0.10.5");
    const literal = "120 fps game recording";
    expect(normalize(page(`${literal} - Chrome`, { title: literal })).windowTitle).toBe(literal);
  });

  it("canonicalizes composed characters without compatibility folding or deleting joiners", () => {
    const title = "한글 ① Ａ 👩‍💻";
    expect(normalize({ appName: "Notes", windowTitle: title.normalize("NFD"), title: title.normalize("NFD") }))
      .toEqual({ windowTitle: title, title });
  });

  it("keeps meaningful state distinctions and is idempotent", () => {
    const first = normalize(page("Document - Audio playing - Chrome - Work"));
    expect(first.windowTitle).not.toBe(normalize(page("Document - Chrome - Work")).windowTitle);
    expect(first.windowTitle).not.toBe(normalize(page("Document - Audio playing - Chrome - Personal")).windowTitle);
    expect(normalize({ ...page(""), ...first })).toEqual(first);
    const timer = "25:00 - Focus";
    expect(normalize(page(`${timer} - Chrome`, { title: timer })).windowTitle).toBe(timer);
  });
});
