// Pure, dependency-free renderer for the public "focus" badge (Phase 1 embed feature).
//
// This is the canonical implementation: it is unit-tested here and drives the in-app
// live preview. The public `badge` Supabase Edge Function
// (apps/desktop/supabase/functions/badge/index.ts) keeps an INLINE COPY of these three
// functions so it can deploy as a self-contained Deno module — keep the two in sync until
// Phase 2 consolidates them. Only aggregate, opt-in fields are ever rendered here; raw
// activity never reaches this surface.

export type BadgeTheme = "light" | "dark";

export interface FocusBadgeInput {
  /** Left segment text. Defaults to "focus". */
  label?: string;
  /** Right segment text, e.g. "20h 59m" or "—" when away/unavailable. */
  value: string;
  theme?: BadgeTheme;
  /** Right segment background. Defaults to Drifty focus green. */
  accent?: string;
}

export const FOCUS_GREEN = "#2e9e4f";
export const AWAY_GREY = "#9a9e96";

/** Seconds → compact "Xh Ym" / "Ym" label. Non-positive / invalid → "0m". */
export function formatFocusDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0m";
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return char;
    }
  });
}

// Approximate advance width per character at 11px Verdana. Exact metrics aren't available
// without a font table, so we over-pad slightly and center text within each segment; small
// estimate errors only shift the centered text, never overflow it.
function estimateTextWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/[iIl.:'|!,;]/.test(char)) width += 3.3;
    else if (/[mwMW]/.test(char)) width += 9.2;
    else if (/[0-9]/.test(char)) width += 6.6;
    else if (char === " ") width += 3.6;
    else width += 6.6;
  }
  return width;
}

/** Render a shields-style flat "focus" badge as an SVG string. */
export function renderFocusBadgeSvg({ label = "focus", value, theme = "light", accent = FOCUS_GREEN }: FocusBadgeInput): string {
  const leftText = (label.trim() || "focus");
  const rightText = (value.trim() || "—");
  const pad = 6;
  const height = 20;
  const leftWidth = Math.max(30, Math.round(estimateTextWidth(leftText) + pad * 2));
  const rightWidth = Math.max(28, Math.round(estimateTextWidth(rightText) + pad * 2));
  const totalWidth = leftWidth + rightWidth;
  const labelBg = theme === "dark" ? "#23271f" : "#4b514a";
  const leftCenter = leftWidth / 2;
  const rightCenter = leftWidth + rightWidth / 2;
  const l = escapeXml(leftText);
  const r = escapeXml(rightText);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${l}: ${r}">
<title>${l}: ${r}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${leftWidth}" height="${height}" fill="${labelBg}"/>
<rect x="${leftWidth}" width="${rightWidth}" height="${height}" fill="${escapeXml(accent)}"/>
<rect width="${totalWidth}" height="${height}" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${leftCenter}" y="15" fill="#010101" fill-opacity=".3">${l}</text>
<text x="${leftCenter}" y="14">${l}</text>
<text x="${rightCenter}" y="15" fill="#010101" fill-opacity=".3">${r}</text>
<text x="${rightCenter}" y="14">${r}</text>
</g>
</svg>`;
}
