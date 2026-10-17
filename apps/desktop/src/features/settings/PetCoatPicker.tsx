import { isLookPending } from "../pro-looks/proLooks";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModalPresence } from "../../components/ModalPresence";
import { PET_MODE_QUICK_COATS, createPetModeCustomCoat } from "../pet-mode/petModeCoats";
import { PetSkinDialog, PetSkinSwatch, petSkinRadioKey } from "./PetSkinDialog";
import { Toggle } from "../../components/Toggle";
import { SettingsSelect } from "./SettingsSelect";
import {
  PET_MODE_SIZES,
  type PetModeCoat,
  type PetModeSize,
} from "../pet-mode/petModeData";
import { usePetPresenceMode, type PetPresenceMode } from "../pet-mode/petPresenceMode";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { ProLookRowNote } from "../pro-looks/ProLookViews";
import { useProLooks } from "../pro-looks/useProLooksController";

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

// Five representative skins plus More keep the row stable as the catalog grows.
// Picking a skin outside the representatives replaces only the fifth slot.
export function PetCoatPicker({ value, onChange, disabled = false }: {
  readonly value: PetModeCoat;
  readonly onChange: (coat: PetModeCoat) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useLocalization();
  const looks = useProLooks();
  const latestLooks = useRef(looks);
  latestLooks.current = looks;
  useEffect(() => () => {
    const current = latestLooks.current;
    if (current?.popover?.look.kind === "coat") current.closePopover();
  }, []);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<PetModeCoat>(() => value.startsWith("custom-") ? value : createPetModeCustomCoat(18,74));
  useEffect(() => {
    if (value.startsWith("custom-")) setCustom(value);
  }, [value]);
  // The pending account/Pro flow now owns the try-on; close only the picker.
  const unlock = () => { looks?.unlock(); setOpen(false); };
  const slots: PetModeCoat[] = [...PET_MODE_QUICK_COATS];
  if (!slots.includes(value)) slots[4] = value;
  const pick = (coat: PetModeCoat) => looks ? looks.pick({ kind: "coat", id: coat }) : onChange(coat);
  const close = () => { looks?.closePopover(); setOpen(false); };
  return (
    <div data-setting-id="settings.pet.coat" className={`settings-row settings-row--pet-coat${disabled ? " settings-row--disabled" : ""}`}>
      <div><div className="lbl">{t("settings.pet.coat")}</div></div>
      <div className="ctrl">
        <div className="pet-skin-quick-row">
          <div className="pet-coat-picker" role="radiogroup" aria-label={t("settings.pet.coat")} aria-disabled={disabled} onKeyDown={petSkinRadioKey}>
            {slots.map(coat => {
              const locked = looks?.isLocked({ kind: "coat", id: coat }) ?? false;
              return <PetSkinSwatch key={coat} coat={coat} selected={value === coat} trying={false} locked={locked} disabled={disabled}
                tabIndex={value === coat ? 0 : -1}
                onPick={() => { pick(coat); if (locked || (looks && isLookPending({ kind: "coat", id: coat }, looks.access) && coat !== value && coat !== looks.keptCoat)) setOpen(true); }} />;
            })}
          </div>
          <button type="button" className="pet-skin-more" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
            <span aria-hidden="true">···</span><span>{t("settings.pet.skinMore")}</span>
          </button>
        </div>
        {looks ? <ProLookRowNote looks={looks} kind="coat" /> : null}
      </div>
      {createPortal(<ModalPresence>{open ? <PetSkinDialog value={value} custom={custom} onCustomChange={setCustom} onPick={pick} onClose={close} onUnlock={unlock} looks={looks} /> : null}</ModalPresence>, document.body)}
    </div>
  );
}
