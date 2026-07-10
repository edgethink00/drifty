// Builds the copy-paste embed snippets shown in the in-app "Embed" panel (Phase 1).
// Pure and dependency-light so it can be unit-tested and reused by the live preview.
//
// Every public surface is served under the same branded origin, drifty.so:
//   - profile page   → drifty.so/profile/?id=…
//   - card / chart    → drifty.so/embed/?id=… (hosted iframe page)
//   - focus badge     → drifty.so/embed/badge?id=… (Cloudflare Pages Function that
//                       proxies the public Supabase `badge` Edge Function)
//   - raw JSON        → drifty.so/embed/badge?id=…&format=json
//
// Keeping the badge under drifty.so (rather than the raw *.supabase.co functions URL)
// means README badges never break if the backend project/ref changes — the public URL
// is a stable, ownable namespace. No Supabase URL leaks into the generated snippets.

const EMBED_ORIGIN = "https://drifty.so";

/** Hosted public profile URL. */
export function buildProfileUrl(publicId: string): string {
  return `${EMBED_ORIGIN}/profile/?id=${encodeURIComponent(publicId)}`;
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
  let url = `${EMBED_ORIGIN}/embed/?id=${encodeURIComponent(publicId)}`;
  if (options.theme === "dark") url += "&theme=dark";
  if (options.range === 30) url += "&range=30";
  return url;
}

/** Hosted iframe 30-day focus/drift chart URL (drifty.so/embed, chart view). */
export function buildChartEmbedUrl(publicId: string, options: EmbedSnippetOptions = {}): string {
  let url = `${EMBED_ORIGIN}/embed/?id=${encodeURIComponent(publicId)}&view=chart`;
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

/** Public focus badge image, served under the drifty.so /embed namespace. */
export function buildBadgeUrl(publicId: string, options: EmbedSnippetOptions = {}): string {
  let url = `${EMBED_ORIGIN}/embed/badge?id=${encodeURIComponent(publicId)}`;
  if (options.theme === "dark") url += "&theme=dark";
  return url;
}

/** GET endpoint returning the card's aggregate JSON (incl. the 30-day daily series). */
export function buildDataUrl(publicId: string): string {
  return `${buildBadgeUrl(publicId)}&format=json`;
}

export function buildEmbedSnippets(publicId: string, options: EmbedSnippetOptions = {}): EmbedSnippets {
  const badgeUrl = buildBadgeUrl(publicId, options);
  const embedUrl = buildEmbedUrl(publicId, options);
  const profileUrl = buildProfileUrl(publicId);
  const dataUrl = buildDataUrl(publicId);
  const chartEmbedUrl = buildChartEmbedUrl(publicId, options);
  const markdown = `[![Drifty focus](${badgeUrl})](${profileUrl})`;
  const iframe = `<iframe src="${embedUrl}" width="440" height="${options.range === 30 ? 200 : 180}" style="border:0;overflow:hidden" scrolling="no" title="Drifty focus"></iframe>`;
  const chartIframe = `<iframe src="${chartEmbedUrl}" width="560" height="260" style="border:0;overflow:hidden" scrolling="no" title="Drifty focus chart"></iframe>`;
  const html = `<a href="${profileUrl}"><img src="${badgeUrl}" alt="Drifty focus" height="20"></a>`;
  return { badgeUrl, embedUrl, profileUrl, dataUrl, markdown, iframe, chartIframe, html };
}
