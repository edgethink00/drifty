/** Directional chevron for step controls (date navigation, pagination).
 *
 *  Step controls used to render the "&lsaquo;" / "&rsaquo;" punctuation
 *  characters. Those glyphs are single angle quotation marks: the font draws
 *  them around x-height, so at the button's own font size the visible stroke
 *  measured only ~55% of the neighbouring label's cap height. Raising
 *  font-size could not fix that without making the mark float like a quote,
 *  and stroke weight stayed tied to font-weight.
 *
 *  Drawing the chevron instead puts size, stroke weight, and optical
 *  alignment under separate control, and lets the mark inherit the shared
 *  ".app-btn > svg" 14px sizing contract that every other button icon uses. */
export function NavChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg className="nav-chevron" data-direction={direction} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4 10 8 6 12" />
    </svg>
  );
}
