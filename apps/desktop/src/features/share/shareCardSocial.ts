import type { HostPlatform } from "../../lib/api/accessibilityClient";

export type ShareCardDestination = "linkedin" | "x";

export const SHARE_CARD_IMAGE_PASTE_HINT = "Image copied — paste it here with ⌘V.";
export const SHARE_CARD_IMAGE_PASTE_HINT_WINDOWS = "Image copied — paste it here with Ctrl+V.";
export const SHARE_CARD_DEFAULT_CAPTION = "Here's a focus snapshot from Drifty.";

/** A deliberately simple social draft; the card itself carries the detail. */
export function buildShareCardCaption(): string {
  return SHARE_CARD_DEFAULT_CAPTION;
}

/** The short post text placed in a social composer alongside the copied PNG. */
export function buildShareCardComposerText(caption: string, platform: HostPlatform = "macos"): string {
  const pasteHint = platform === "macos" ? SHARE_CARD_IMAGE_PASTE_HINT : SHARE_CARD_IMAGE_PASTE_HINT_WINDOWS;
  return `${caption}\n\n${pasteHint}`;
}

export function buildShareComposerUrl(
  destination: ShareCardDestination,
  caption: string,
  platform: HostPlatform = "macos",
): string {
  const text = buildShareCardComposerText(caption, platform);
  if (destination === "linkedin") {
    // LinkedIn does not document a reliable image-post prefill API. `text` is a
    // best-effort composer hint; the copied PNG and in-app paste instruction remain
    // the dependable handoff when LinkedIn ignores it.
    return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
  }
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
