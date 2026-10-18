import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { PET_MODE_COAT_FAMILIES, PET_MODE_COAT_SPECS, createPetModeCustomCoat, getPetModeCoatSpec, parsePetModeCustomCoat, petSkinOklchHex, type PetModeCoat } from "../pet-mode/petModeCoats";
import { localizedPetCoatLabel } from "../pro-looks/proLookCatalog";
import { ProLookLockBadge, proLookActionKey } from "../pro-looks/ProLookViews";
import type { ProLooksController } from "../pro-looks/useProLooksController";
import { PetCoatSwatchCat } from "./PetCoatSwatchCat";
import "./pet-skin-picker.css";

export function petSkinRadioKey(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled)'));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
  buttons[next]?.click();
}

export function PetSkinSwatch({ coat, selected, trying, locked, disabled, onPick, nameVisible = true, tabIndex = 0, describedBy }: {
  readonly coat: PetModeCoat;
  readonly selected: boolean;
  readonly trying: boolean;
  readonly locked: boolean;
  readonly disabled?: boolean;
  readonly onPick: () => void;
  readonly nameVisible?: boolean;
  readonly tabIndex?: number;
  readonly describedBy?: string;
}) {
  const { t } = useLocalization();
  const spec = getPetModeCoatSpec(coat), name = localizedPetCoatLabel(coat, t);
  const label = locked ? t("settings.proLooks.lockedLabel", { name }) : name;
  return (
    <button type="button" role="radio" aria-checked={trying || selected} aria-label={label}
      aria-describedby={describedBy} title={label} disabled={disabled} tabIndex={tabIndex}
      className={`pet-coat-swatch${selected ? " is-selected" : ""}${trying ? " is-trying-on" : ""}`}
      style={{ "--pet-coat-fur": spec.fur, "--pet-coat-ink": spec.ink } as CSSProperties}
      data-pro-look={`coat:${coat}`} onClick={onPick}>
      <PetCoatSwatchCat coat={coat} />
      {nameVisible ? <span className="pet-coat-swatch__label">{name}</span> : null}
      {locked ? <ProLookLockBadge /> : null}
    </button>
  );
}

export function PetSkinDialog({ value, custom, onCustomChange, onPick, onClose, onUnlock, looks }: {
  readonly value: PetModeCoat;
  readonly custom: PetModeCoat;
  readonly onCustomChange: (coat: PetModeCoat) => void;
  readonly onPick: (coat: PetModeCoat) => void;
  readonly onClose: () => void;
  readonly onUnlock: () => void;
  readonly looks: ProLooksController | null;
}) {
  const { t } = useLocalization();
  const id = useId(), customButton = useRef<HTMLButtonElement>(null);
  const [editor, setEditor] = useState(false);
  const preview = looks?.preview?.kind === "coat" ? looks.preview.id : null;
  const shown = preview ?? value, spec = getPetModeCoatSpec(shown);
  const customValues = parsePetModeCustomCoat(custom) ?? { hue: 18, lightness: 74 };
  const checking = looks?.popover?.look.kind === "coat" && looks.popover.mode === "checking";
  const actionKey = preview && looks ? proLookActionKey(looks.access) : null;
  const collapseOrClose = () => {
    if (editor) { setEditor(false); customButton.current?.focus(); }
    else onClose();
  };
  useModalDismiss(collapseOrClose);
  const overlay = useOverlayDismiss(onClose);
  const pick = (coat: PetModeCoat) => { setEditor(false); onPick(coat); };
  const updateCustom = (hue: number, lightness: number) => {
    const coat = createPetModeCustomCoat(hue, lightness);
    onCustomChange(coat);
    onPick(coat);
  };
  const hueGradient = `linear-gradient(90deg,${Array.from({ length: 13 }, (_, i) => petSkinOklchHex(.74,.07,i*30)).join(",")})`;
  const lightnessGradient = `linear-gradient(90deg,${[.30,.60,.92].map(l => petSkinOklchHex(l,.06,customValues.hue)).join(",")})`;
  const customSpec = getPetModeCoatSpec(custom);
  const customActive = shown.startsWith("custom-");
  return (
    <div className="auth-modal__overlay pet-skin-overlay" {...overlay}>
      <section className="modal-shell pet-skin-dialog" data-modal-variant="workspace" role="dialog" aria-modal="true"
        aria-label={t("settings.pet.coat")} onClick={event => event.stopPropagation()}>
        <ModalCloseButton label={t("settings.proLooks.close")} onClick={onClose} />
        <div className="pet-skin-preview">
          <div className="pet-skin-preview__core">
            <div className="pet-skin-preview__art" style={{ "--pet-coat-fur": spec.fur, "--pet-coat-ink": spec.ink } as CSSProperties}>
              <PetCoatSwatchCat coat={shown} />
            </div>
            <div className="pet-skin-preview__name" aria-live="polite">
              {localizedPetCoatLabel(shown, t)}
              {preview ? <span>{t("settings.pet.skinTrying")}</span> : null}
            </div>
            <div className="pet-skin-preview__action">
              {looks?.trialStartFailed === "coat" ? <span role="alert">{t("billing.trialActivation.failed")}</span> : null}
              {checking ? <span role="status">{t("settings.proLooks.checking")}</span> : null}
              {actionKey && looks ? <button className="modal-btn modal-btn--primary" type="button" onClick={onUnlock}>{t(actionKey)}</button> : null}
            </div>
          </div>
        </div>
        <div className="pet-skin-list">
          <div role="radiogroup" aria-label={t("settings.pet.coat")} onKeyDown={petSkinRadioKey}>
            {PET_MODE_COAT_FAMILIES.map(family => (
              <div className="pet-skin-group" key={family}>
                <span className="pet-skin-group__name" id={`${id}-${family}`}>{t(`settings.pet.skinFamily.${family}` as TranslationKey)}</span>
                <div className="pet-skin-group__chips">
                  {PET_MODE_COAT_SPECS.filter(coat => coat.family === family).map(coat => (
                    <PetSkinSwatch key={coat.value} coat={coat.value} selected={!preview && value === coat.value}
                      trying={preview === coat.value} locked={looks?.isLocked({ kind: "coat", id: coat.value }) ?? false}
                      nameVisible={false} describedBy={`${id}-${family}`}
                      tabIndex={shown === coat.value || (customActive && coat.value === "ivory") ? 0 : -1}
                      onPick={() => pick(coat.value)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="pet-skin-group pet-skin-group--custom">
            <span className="pet-skin-group__name">{t("settings.pet.skinCustom")}</span>
            <div className="pet-skin-custom-row">
              <button ref={customButton} type="button" aria-label={t("settings.pet.skinCustom")}
                aria-expanded={editor} aria-controls={`${id}-editor`} aria-pressed={customActive}
                className={`pet-skin-custom${customActive ? " is-selected" : ""}`}
                style={customActive ? { "--pet-coat-fur": customSpec.fur, "--pet-coat-ink": customSpec.ink } as CSSProperties : undefined}
                onClick={() => { if (!editor) onPick(custom); setEditor(!editor); }}>
                {customActive ? <PetCoatSwatchCat /> : <span className="pet-skin-custom__rainbow" aria-hidden="true" />}
                {looks?.isLocked({ kind: "coat", id: custom }) ? <ProLookLockBadge /> : null}
              </button>
              <div className={`pet-skin-editor${editor ? " is-open" : ""}`} id={`${id}-editor`} aria-hidden={!editor}>
                <input type="range" aria-label={t("settings.pet.skinHue")} min="0" max="359" step="1" value={customValues.hue}
                  style={{ background: hueGradient, "--skin-thumb": petSkinOklchHex(.74,.07,customValues.hue) } as CSSProperties}
                  onChange={event => updateCustom(Number(event.target.value), customValues.lightness)} />
                <input type="range" aria-label={t("settings.pet.skinLightness")} min="30" max="92" step="1" value={customValues.lightness}
                  style={{ background: lightnessGradient, "--skin-thumb": customSpec.fur } as CSSProperties}
                  onChange={event => updateCustom(customValues.hue, Number(event.target.value))} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
