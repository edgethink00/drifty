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

export type BadgeThemeOption = "light" | "dark";
export type CardRangeOption = 7 | 30;

export interface EmbedSnippetOptions {
  /** Badge + card theme; defaults (light) are omitted from URLs. */
  readonly theme?: BadgeThemeOption;
  /** Card daily-chart range; the default 7 is omitted from URLs. */
  readonly range?: CardRangeOption;
}

/** Hosted iframe focus-card URL (drifty.so/embed). */
export function buildEmbedUrl(publicId: string, options: EmbedSnippetOptions = {}): string {
  let url = `https://drifty.so/embed/?id=${encodeURIComponent(publicId)}`;
  if (options.theme === "dark") url += "&theme=dark";
  if (options.range === 30) url += "&range=30";
  return url;
}

/** Hosted iframe 30-day focus/drift chart URL (drifty.so/embed, chart view). */
export function buildChartEmbedUrl(publicId: string, options: EmbedSnippetOptions = {}): string {
  let url = `https://drifty.so/embed/?id=${encodeURIComponent(publicId)}&view=chart`;
  if (options.theme === "dark") url += "&theme=dark";
  return url;
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
  /** <iframe> 30-day focus/drift chart for blogs/sites. */
  chartIframe: string;
  /** Raw HTML image badge for blogs/sites. */
  html: string;
}

/** `https://<ref>.supabase.co` → `https://<ref>.supabase.co/functions/v1`. */
export function functionsBaseFromSupabaseUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;
}

export function buildBadgeUrl(publicId: string, functionsBaseUrl: string, options: EmbedSnippetOptions = {}): string {
  const base = functionsBaseUrl.replace(/\/+$/, "");
  let url = `${base}/badge?id=${encodeURIComponent(publicId)}`;
  if (options.theme === "dark") url += "&theme=dark";
  return url;
}

/** GET endpoint returning the card's aggregate JSON (incl. the 30-day daily series). */
export function buildDataUrl(publicId: string, functionsBaseUrl: string): string {
  return `${buildBadgeUrl(publicId, functionsBaseUrl)}&format=json`;
}

export function buildEmbedSnippets(publicId: string, functionsBaseUrl: string, options: EmbedSnippetOptions = {}): EmbedSnippets {
  const badgeUrl = buildBadgeUrl(publicId, functionsBaseUrl, options);
  const embedUrl = buildEmbedUrl(publicId, options);
  const profileUrl = buildProfileUrl(publicId);
  const dataUrl = buildDataUrl(publicId, functionsBaseUrl);
  const chartEmbedUrl = buildChartEmbedUrl(publicId, options);
  const markdown = `[![Drifty focus](${badgeUrl})](${profileUrl})`;
  const iframe = `<iframe src="${embedUrl}" width="440" height="${options.range === 30 ? 200 : 180}" style="border:0;overflow:hidden" scrolling="no" title="Drifty focus"></iframe>`;
  const chartIframe = `<iframe src="${chartEmbedUrl}" width="560" height="260" style="border:0;overflow:hidden" scrolling="no" title="Drifty focus chart"></iframe>`;
  const html = `<a href="${profileUrl}"><img src="${badgeUrl}" alt="Drifty focus" height="20"></a>`;
  return { badgeUrl, embedUrl, profileUrl, dataUrl, markdown, iframe, chartIframe, html };
}
