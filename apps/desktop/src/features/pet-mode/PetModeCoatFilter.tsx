import { memo } from "react";
import { petModeCoatRamp, type PetModeCoat } from "./petModeCoats";

// Same 18-step ramp as the shipped six: flatten RGB, clamp ink/body, keep
// alpha. The 1e-6 bias in the ramp avoids an 8-bit compositor rounding drift.
export const PetModeCoatFilter = memo(function PetModeCoatFilter({ coat }: { readonly coat: PetModeCoat }) {
  const [red, green, blue] = petModeCoatRamp(coat);
  return (
    <svg className="pet-mode-cat__filters" width="0" height="0" aria-hidden="true">
      <filter id={`pet-mode-coat-${coat}`} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0.3333 0.3333 0.3333 0 0 0.3333 0.3333 0.3333 0 0 0.3333 0.3333 0.3333 0 0 0 0 0 1 0" />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={red} />
          <feFuncG type="table" tableValues={green} />
          <feFuncB type="table" tableValues={blue} />
          <feFuncA type="identity" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
});
