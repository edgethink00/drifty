import { Toggle } from "../../components/Toggle";
import {
  PET_MODE_COAT_SPECS,
  PET_MODE_SIZES,
  type PetModeCoat,
  type PetModeSize,
} from "../pet-mode/petModeData";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";

// The pet's user-facing settings, shown in Companion & Alerts. Visibility is
// also toggleable from the account menu; both write the same stored value.
export function PetSettings({
  enabled,
  onEnabledChange,
  coat,
  onCoatChange,
  size,
  onSizeChange,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly coat: PetModeCoat;
  readonly onCoatChange: (coat: PetModeCoat) => void;
  readonly size: PetModeSize;
  readonly onSizeChange: (size: PetModeSize) => void;
}) {
  const { t } = useLocalization();
  return (
    <>
      <div className="settings-row settings-row--pet-mode" role="group" aria-label={t("settings.pet.title")}>
        <div>
          {/* The block heading already says "Desktop pet"; this row names the
              action, matching "Drift alerts / Show drift alerts" next door and
              the account menu's own "Show pet". */}
          <div className="lbl">{t("settings.pet.show")}</div>
          <div className="desc">{t("settings.pet.description")}</div>
        </div>
        <div className="ctrl">
          <Toggle checked={enabled} onChange={onEnabledChange} ariaLabel={t("settings.pet.toggleAria")} />
        </div>
      </div>
      {/* Kept visible but inert while the pet is off, matching how Extreme
          nudge dims under Drift alerts. Hiding them made the block change
          height on every toggle and hid the fact that a coat is already
          chosen. */}
      <PetCoatPicker value={coat} onChange={onCoatChange} disabled={!enabled} />
      <PetSizePicker value={size} onChange={onSizeChange} disabled={!enabled} />
    </>
  );
}

function PetSizePicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: PetModeSize;
  readonly onChange: (size: PetModeSize) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useLocalization();
  return (
    <div className={`settings-row settings-row--pet-size${disabled ? " settings-row--disabled" : ""}`}>
      <div>
        <div className="lbl">{t("settings.pet.size")}</div>
      </div>
      <div className="ctrl">
        <div className="settings-mode-switch settings-mode-switch--compact" role="radiogroup" aria-label={t("settings.pet.size")} aria-disabled={disabled}>
          {PET_MODE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={`settings-mode-option${size === value ? " is-active" : ""}`}
              role="radio"
              aria-checked={size === value}
              disabled={disabled}
              onClick={() => onChange(size)}
            >
              <span>{size}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// A coat picker that shows plain color chips would make the user translate
// "Grey" into a mental image of the pet. These swatches draw the actual
// silhouette in the actual fur and ink, so the choice is visible rather than
// named. The grid wraps, so adding coats does not require touching layout.
export function PetCoatPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: PetModeCoat;
  readonly onChange: (coat: PetModeCoat) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useLocalization();
  return (
    <div className={`settings-row settings-row--pet-coat${disabled ? " settings-row--disabled" : ""}`}>
      <div>
        <div className="lbl">{t("settings.pet.coat")}</div>
      </div>
      <div className="ctrl">
        <div className="pet-coat-picker" role="radiogroup" aria-label={t("settings.pet.coat")} aria-disabled={disabled}>
          {PET_MODE_COAT_SPECS.map((spec) => {
            const label = localizedPetCoatLabel(spec.value, t);
            return (
            <button
              key={spec.value}
              type="button"
              className={`pet-coat-swatch${spec.value === value ? " is-selected" : ""}`}
              style={{ "--pet-coat-fur": spec.fur, "--pet-coat-ink": spec.ink } as React.CSSProperties}
              role="radio"
              aria-checked={spec.value === value}
              aria-label={label}
              title={label}
              disabled={disabled}
              onClick={() => onChange(spec.value)}
            >
              <PetCoatSwatchCat />
              <span className="pet-coat-swatch__label">{label}</span>
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const PET_COAT_LABEL_KEYS: Readonly<Record<PetModeCoat, TranslationKey>> = {
  ivory: "settings.pet.coatIvory",
  charcoal: "settings.pet.coatCharcoal",
  grey: "settings.pet.coatGrey",
  apricot: "settings.pet.coatApricot",
  sage: "settings.pet.coatSage",
  plum: "settings.pet.coatPlum",
};

function localizedPetCoatLabel(
  coat: PetModeCoat,
  t: LocalizationController["t"],
): string {
  return t(PET_COAT_LABEL_KEYS[coat]);
}

// The pet's resting pose is a baked bitmap, not a vector, so an approximated
// path never quite matches what the user sees on their desktop. Instead the
// swatch masks a solid fill with that exact bitmap: the silhouette is pixel
// identical to the real pet, and the fill follows each coat's fur token. The
// face is drawn on top from the same frame's ink positions.
function PetCoatSwatchCat() {
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
