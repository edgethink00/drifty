// Builds the copy-paste embed snippets shown in the in-app "Embed" panel (Phase 1).
// Pure and dependency-light so it can be unit-tested and reused by the live preview.
//
// Phase 1 ships four working formats: a README image badge (served by the public `badge`
// Edge Function), an <iframe> rich card (drifty.so/embed), a raw HTML badge, and the hosted
// profile link. All point at surfaces that exist.
//
// The profile URL is built here rather than imported from ProfileModals so this module stays
// dependency-free (no React) and avoids an import cycle; it mirrors buildPublicProfileUrl.

/** Hosted public profile URL (mirrors ProfileModals.buildPublicProfileUrl). */
export function buildProfileUrl(publicId: string): string {
  return `https://drifty.so/profile/?id=${encodeURIComponent(publicId)}`;
}

/** Hosted iframe focus-card URL (drifty.so/embed). */
export function buildEmbedUrl(publicId: string): string {
  return `https://drifty.so/embed/?id=${encodeURIComponent(publicId)}`;
}

export interface EmbedSnippets {
  badgeUrl: string;
  embedUrl: string;
  profileUrl: string;
  /** Raw aggregate JSON (GET), incl. the 30-day daily focus series — for custom widgets. */
  dataUrl: string;
  /** GitHub README / Markdown: image badge linking to the hosted profile. */
  markdown: string;
  /** <iframe> rich focus card for blogs/sites. */
  iframe: string;
  /** Raw HTML image badge for blogs/sites. */
  html: string;
}

/** `https://<ref>.supabase.co` → `https://<ref>.supabase.co/functions/v1`. */
export function functionsBaseFromSupabaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;
}

export function buildBadgeUrl(publicId: string, functionsBaseUrl: string): string {
  const base = functionsBaseUrl.replace(/\/+$/, "");
  return `${base}/badge?id=${encodeURIComponent(publicId)}`;
}

/** GET endpoint returning the card's aggregate JSON (incl. the 30-day daily series). */
export function buildDataUrl(publicId: string, functionsBaseUrl: string): string {
  return `${buildBadgeUrl(publicId, functionsBaseUrl)}&format=json`;
}

export function buildEmbedSnippets(publicId: string, functionsBaseUrl: string): EmbedSnippets {
  const badgeUrl = buildBadgeUrl(publicId, functionsBaseUrl);
  const embedUrl = buildEmbedUrl(publicId);
  const profileUrl = buildProfileUrl(publicId);
  const dataUrl = buildDataUrl(publicId, functionsBaseUrl);
  const markdown = `[![Drifty focus](${badgeUrl})](${profileUrl})`;
  const iframe = `<iframe src="${embedUrl}" width="440" height="180" style="border:0;overflow:hidden" scrolling="no" title="Drifty focus"></iframe>`;
  const html = `<a href="${profileUrl}"><img src="${badgeUrl}" alt="Drifty focus" height="20"></a>`;
  return { badgeUrl, embedUrl, profileUrl, dataUrl, markdown, iframe, html };
}
