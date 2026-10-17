import { getPetModeCoatStyle } from "../pet-mode/petModeCoats";
import { useProLooks } from "../pro-looks/useProLooksController";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import { PetModeCat } from "../pet-mode/PetModeCat";
import { getPetModeCoatSpec, type PetModeCoat, type PetModeSize } from "../pet-mode/petModeData";
import "../pet-mode/petMode.css";
import { localizedPetCoatLabel } from "./PetCoatPicker";

export function PetSettingsPreview({ enabled, coat, size }: {
  readonly enabled: boolean;
  readonly coat: PetModeCoat;
  readonly size: PetModeSize;
}) {
  const { t } = useLocalization();
  const [happy, setHappy] = useState(false);
  const wasEnabled = useRef(enabled);
  const looks = useProLooks();
  const shownCoat = looks?.preview?.kind === "coat" ? looks.preview.id : coat;
  const spec = getPetModeCoatSpec(shownCoat);
  const previewLabel = t(enabled ? "settings.pet.preview" : "settings.pet.previewOff", {
    size,
    coat: localizedPetCoatLabel(shownCoat, t),
  });

  useEffect(() => {
    const justEnabled = enabled && !wasEnabled.current;
    wasEnabled.current = enabled;
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!justEnabled || reducedMotion) {
      setHappy(false);
      return;
    }
    setHappy(true);
    // Match the onboarding greeting; appearance changes do not restart it.
    const timeout = window.setTimeout(() => setHappy(false), 1_200);
    return () => window.clearTimeout(timeout);
  }, [enabled]);

  return (
    <div className={`pet-settings-preview${enabled ? "" : " is-off"}`} role="img" aria-label={previewLabel}>
      <div className="pet-settings-preview__stage" aria-hidden="true" style={{
        ...getPetModeCoatStyle(shownCoat),
        "--pet-fur": spec.fur,
        "--pet-ink": spec.ink,
        "--pet-raster-filter": `url("#pet-mode-coat-${shownCoat}")`,
        "--pet-size-scale": size / 100,
      } as CSSProperties}>
        <div className="pet-settings-preview__cat">
          <PetModeCat coat={shownCoat} phase={enabled && happy ? "happy" : "idle"} facing="right" pawFrame={0}
            publishHitRegion={false} decorative />
        </div>
      </div>
      <span className="pet-settings-preview__caption">{previewLabel}</span>
    </div>
  );
}
