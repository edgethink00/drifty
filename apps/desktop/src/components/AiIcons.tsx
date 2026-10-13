import "./ai-icons.css";

/*
 * Drifty's AI mark: one full, soft four-point star. Each side is two mirrored
 * cubic curves meeting at the waist, and the tips are rounded inside the same
 * curves, so tangent and curvature run on continuously with no visible joint
 * where the rounding starts. It stays monochrome in currentColor, so selection
 * and theme colours apply to it exactly as they do to the neighbouring icons.
 * The waist sits at 73% of a straight-sided diamond and the tips round over 5%
 * of the star's radius (owner-tuned; the waist handles are 2.4 units long).
 * - AiMarkIcon: the AI entry point in navigation, menus and the command bar.
 *   Every neighbour there is a line icon, so the star is drawn as an outline at
 *   the list's stroke weight; filled, it was the one solid glyph in the list.
 * - AiFieldMark: the solid star before an input label whose text the AI reads,
 *   in the label's own colour and sized from its font. At text size it is a
 *   marker rather than a list icon, and an outline would thin out next to type.
 * - AiReclassifyIcon: a refresh arrow around a small copy of the star for
 *   "reclassify with AI".
 * The star is centred on (12, 12) in a 24-unit box, so callers size it with CSS alone.
 */
const AI_STAR = "M12 2C13.245 2 13.953 6.653 15.65 8.35C17.347 10.047 22 10.755 22 12C22 13.245 17.347 13.953 15.65 15.65C13.953 17.347 13.245 22 12 22C10.755 22 10.047 17.347 8.35 15.65C6.653 13.953 2 13.245 2 12C2 10.755 6.653 10.047 8.35 8.35C10.047 6.653 10.755 2 12 2Z";
const REFRESH_ARC = "M20.5 12a8.5 8.5 0 1 1-2.49-6.01L20.5 8.5";
const REFRESH_HEAD = "M20.5 3.5v5h-5";

function AiStar({ transform }: { readonly transform?: string }) {
  return (
    <path d={AI_STAR} transform={transform} fill="currentColor" stroke="none" />
  );
}

export function AiMarkIcon({ strokeWidth = 1.8 }: { readonly strokeWidth?: number }) {
  return (
    <svg className="ai-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={AI_STAR} />
    </svg>
  );
}

export function AiFieldMark() {
  return (
    <span className="ai-field-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <AiStar />
      </svg>
    </span>
  );
}

export function AiReclassifyIcon() {
  return (
    <svg className="ai-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={REFRESH_ARC} />
      <path d={REFRESH_HEAD} />
      {/* The same star, shrunk into the arrow's centre. */}
      <AiStar transform="translate(12 12) scale(0.42) translate(-12 -12)" />
    </svg>
  );
}

