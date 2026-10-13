import "./ai-icons.css";

/*
 * Drifty's AI mark: one full, soft four-point star. Each side is two mirrored
 * cubic curves meeting at the waist, and the tips are rounded inside the same
 * curves, so tangent and curvature run on continuously with no visible joint
 * where the rounding starts. It stays monochrome in currentColor, so selection
 * and theme colours apply to it exactly as they do to the neighbouring icons;
 * the account menu already mixes solid glyphs (the pet paw) with line icons.
 * - AiMarkIcon: the AI entry point in navigation, menus and the command bar.
 * - AiFieldMark: the same star before an input label whose text the AI reads,
 *   in the label's own colour and sized from its font.
 * - AiReclassifyIcon: a refresh arrow around a small copy of the star for
 *   "reclassify with AI".
 * The star is centred on (12, 12) in a 24-unit box, so callers size it with CSS alone.
 */
const AI_STAR = "M12 2C13.218 2 14.153 6.453 15.85 8.15C17.547 9.847 22 10.782 22 12C22 13.218 17.547 14.153 15.85 15.85C14.153 17.547 13.218 22 12 22C10.782 22 9.847 17.547 8.15 15.85C6.453 14.153 2 13.218 2 12C2 10.782 6.453 9.847 8.15 8.15C9.847 6.453 10.782 2 12 2Z";
const REFRESH_ARC = "M20.5 12a8.5 8.5 0 1 1-2.49-6.01L20.5 8.5";
const REFRESH_HEAD = "M20.5 3.5v5h-5";

function AiStar({ transform }: { readonly transform?: string }) {
  return (
    <path d={AI_STAR} transform={transform} fill="currentColor" stroke="none" />
  );
}

export function AiMarkIcon() {
  return (
    <svg className="ai-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <AiStar />
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

