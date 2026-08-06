export type ShareCardDestination = "linkedin" | "x";

export const SHARE_CARD_IMAGE_PASTE_HINT = "Image copied — paste it here with ⌘V.";
export const SHARE_CARD_DEFAULT_CAPTION = "Here's a focus snapshot from Drifty.";

/** A deliberately simple social draft; the card itself carries the detail. */
export function buildShareCardCaption(): string {
  return SHARE_CARD_DEFAULT_CAPTION;
}

/** The short post text placed in a social composer alongside the copied PNG. */
export function buildShareCardComposerText(caption: string): string {
  return `${caption}\n\n${SHARE_CARD_IMAGE_PASTE_HINT}`;
}

export function buildShareComposerUrl(destination: ShareCardDestination, caption: string): string {
  const text = buildShareCardComposerText(caption);
  if (destination === "linkedin") {
    // LinkedIn does not document a reliable image-post prefill API. `text` is a
    // best-effort composer hint; the copied PNG and in-app ⌘V instruction remain
    // the dependable handoff when LinkedIn ignores it.
    return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
  }
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
