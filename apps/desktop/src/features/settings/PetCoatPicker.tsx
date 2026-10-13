import { useState } from "react";
import { Toggle } from "../../components/Toggle";
import { SettingsSelect } from "./SettingsSelect";
import {
  PET_MODE_COAT_SPECS,
  PET_MODE_SIZES,
  type PetModeCoat,
  type PetModeSize,
} from "../pet-mode/petModeData";
import { usePetPresenceMode, type PetPresenceMode } from "../pet-mode/petPresenceMode";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { localizedPetCoatLabel } from "../pro-looks/proLookCatalog";
import { ProLookLockBadge, ProLookPopover, ProLookRowNote } from "../pro-looks/ProLookViews";
import { useProLooks } from "../pro-looks/useProLooksController";
import { PetCoatSwatchCat } from "./PetCoatSwatchCat";

export { localizedPetCoatLabel } from "../pro-looks/proLookCatalog";
export { PetCoatSwatchCat } from "./PetCoatSwatchCat";

// Power and style are separate controls on purpose: the account menu already
// presents the pet as an on/off checkbox. Presence stays disabled while off so
// that choice is visibly preserved; appearance stays editable because the
// preview still shows the dormant cat.
const PET_PRESENCE_MODES: ReadonlyArray<{
  readonly value: PetPresenceMode;
  readonly labelKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
}> = [
  { value: "always", labelKey: "settings.pet.presenceAlways", descriptionKey: "settings.pet.presenceAlwaysDescription" },
  { value: "drift_only", labelKey: "settings.pet.presenceDriftOnly", descriptionKey: "settings.pet.presenceDriftOnlyDescription" },
];

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
  const [presenceMode, setPresenceMode] = usePetPresenceMode();
  // Plain options, matching every other settings select. The row description
  // below the label carries the current choice's sentence instead.
  const presenceOptions = PET_PRESENCE_MODES.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
  const description = PET_PRESENCE_MODES.find((option) => option.value === presenceMode)?.descriptionKey
    ?? "settings.pet.presenceAlwaysDescription";
  return (
    <>
      <div data-setting-id="settings.pet.show" className="settings-row settings-row--pet-mode settings-row--group-start" role="group" aria-label={t("settings.pet.title")}>
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
      <div data-setting-id="settings.pet.presence" className={`settings-row settings-row--pet-presence${enabled ? "" : " settings-row--disabled"}`}>
        <label>
          <div className="lbl">{t("settings.pet.presence")}</div>
          <div className="desc">{t(description)}</div>
        </label>
        <div className="ctrl">
          <SettingsSelect
            ariaLabel={t("settings.pet.presence")}
            value={presenceMode}
            options={presenceOptions}
            disabled={!enabled}
            onChange={setPresenceMode}
          />
        </div>
      </div>
      {/* Keep appearance editable so the dormant preview can still be dressed. */}
      <PetCoatPicker value={coat} onChange={onCoatChange} />
      <PetSizePicker value={size} onChange={onSizeChange} />
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
    <div data-setting-id="settings.pet.size" className={`settings-row settings-row--pet-size${disabled ? " settings-row--disabled" : ""}`}>
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
// Ivory and Grey are free; the other coats are Pro looks (features/pro-looks):
// a locked coat is tried on the desktop pet while its bubble is open.
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
  const looks = useProLooks();
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setRow} data-setting-id="settings.pet.coat" className={`settings-row settings-row--pet-coat${disabled ? " settings-row--disabled" : ""}`}>
      <div>
        <div className="lbl">{t("settings.pet.coat")}</div>
      </div>
      <div className="ctrl">
        <div className="pet-coat-picker" role="radiogroup" aria-label={t("settings.pet.coat")} aria-disabled={disabled}>
          {PET_MODE_COAT_SPECS.map((spec) => {
            const look = { kind: "coat", id: spec.value } as const;
            const name = localizedPetCoatLabel(spec.value, t);
            const locked = looks?.isLocked(look) ?? false;
            const label = locked ? t("settings.proLooks.lockedLabel", { name }) : name;
            const tryingOn = looks?.preview?.kind === "coat" && looks.preview.id === spec.value;
            return (
            <button
              key={spec.value}
              type="button"
              className={"pet-coat-swatch" + (spec.value === value ? " is-selected" : "") + (tryingOn ? " is-trying-on" : "")}
              style={{ "--pet-coat-fur": spec.fur, "--pet-coat-ink": spec.ink } as React.CSSProperties}
              role="radio"
              aria-checked={spec.value === value}
              aria-label={label}
              aria-haspopup={locked ? "dialog" : undefined}
              title={label}
              disabled={disabled}
              data-pro-look={"coat:" + spec.value}
              onClick={() => (looks ? looks.pick(look) : onChange(spec.value))}
            >
              <PetCoatSwatchCat />
              <span className="pet-coat-swatch__label">{name}</span>
              {locked ? <ProLookLockBadge /> : null}
            </button>
            );
          })}
        </div>
        {looks ? <ProLookRowNote looks={looks} kind="coat" /> : null}
      </div>
      {looks ? <ProLookPopover looks={looks} kind="coat" container={row} /> : null}
    </div>
  );
}
