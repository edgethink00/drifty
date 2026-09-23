import { describe, expect, it } from "vitest";
import {
  SHARE_CARD_DEFAULT_CAPTION,
  SHARE_CARD_IMAGE_PASTE_HINT,
  SHARE_CARD_IMAGE_PASTE_HINT_WINDOWS,
  buildShareCardCaption,
  buildShareCardComposerText,
  buildShareComposerUrl,
} from "./shareCardSocial";

describe("share card social handoff", () => {
  it("uses one short, general social draft", () => {
    expect(buildShareCardCaption()).toBe(SHARE_CARD_DEFAULT_CAPTION);
  });

  it("adds a paste instruction to the composer text", () => {
    expect(buildShareCardComposerText("Focused & clear")).toBe(
      `Focused & clear\n\n${SHARE_CARD_IMAGE_PASTE_HINT}`,
    );
  });

  it("uses the Windows paste shortcut in the composer text on Windows", () => {
    expect(buildShareCardComposerText("Focused & clear", "windows")).toBe(
      `Focused & clear\n\n${SHARE_CARD_IMAGE_PASTE_HINT_WINDOWS}`,
    );
  });

  it("opens LinkedIn with a best-effort prefilled caption and paste instruction", () => {
    const url = new URL(buildShareComposerUrl("linkedin", "Focused & clear"));
    expect(url.origin).toBe("https://www.linkedin.com");
    expect(url.pathname).toBe("/feed/");
    expect(url.searchParams.get("shareActive")).toBe("true");
    expect(url.searchParams.get("text")).toBe(`Focused & clear\n\n${SHARE_CARD_IMAGE_PASTE_HINT}`);
  });

  it("prefills the X intent with caption and image-paste instruction", () => {
    const url = new URL(buildShareComposerUrl("x", "Focused & clear"));
    expect(url.origin).toBe("https://x.com");
    expect(url.pathname).toBe("/intent/post");
    expect(url.searchParams.get("text")).toBe(`Focused & clear\n\n${SHARE_CARD_IMAGE_PASTE_HINT}`);
  });
});
