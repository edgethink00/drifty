// The pet's resting pose is a baked bitmap, not a vector, so an approximated
// path never quite matches what the user sees on their desktop. Instead the
// swatch masks a solid fill with that exact bitmap: the silhouette is pixel
// identical to the real pet, and the fill follows each coat's fur token. The
// face is drawn on top from the same frame's ink positions.
export function PetCoatSwatchCat() {
  return (
    <span className="pet-coat-swatch__cat" aria-hidden="true">
      <span className="pet-coat-swatch__body" />
      <svg className="pet-coat-swatch__face" viewBox="0 0 797 581">
        <ellipse cx="581.3" cy="254.7" rx="11.8" ry="12.8" />
        <ellipse cx="679.7" cy="244.1" rx="10" ry="12.4" />
        <path
          d="M616 263 Q616 279 626.5 280 Q634.5 280 636.2 263 Q638 280 646.5 280 Q656 279 656 261"
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

