import { useEffect, useRef, useState, type CSSProperties } from "react";
import { KeyHint } from "../../components/KeyHint";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useSiteIcon } from "../../components/SiteIconContext";
import { useLocalization } from "../localization/LocalizationContext";
import { PetModeCat } from "../pet-mode/PetModeCat";
import { PET_MODE_PAW_CONTACT_FRAME } from "../pet-mode/petModeData";
import { petNameAsSubject, usePetName } from "../pet-mode/petName";
import "../pet-mode/petMode.css";
import "./automatic-close-confirm.css";

/** The site the preview closes: the day's biggest drift, or a familiar video site. */
export type CloseConfirmSource = { readonly label: string; readonly siteDomain: string | null };
const FALLBACK_SOURCE: CloseConfirmSource = { label: "youtube.com", siteDomain: "youtube.com" };

/** The first-run cat's ivory coat (the same coat the intro's cat tile uses). */
const IVORY_CAT_STYLE = {
  "--pet-fur": "#e8e5da", "--pet-ink": "#171916", "--pet-accent": "#a9d66d",
  "--pet-raster-filter": "url(#pet-mode-coat-ivory)", "--pet-drag-raster-filter": "url(#pet-mode-coat-ivory)",
  "--pet-contact-shadow": "rgba(0, 0, 0, .28)", "--pet-drop-shadow": "drop-shadow(0 3px 3px rgba(0, 0, 0, 0.22))",
} as CSSProperties;

const reducedMotion = () => typeof window === "undefined" || typeof window.matchMedia !== "function"
  || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The Automatic close consent (intro card and Settings), in the app's compact confirm shell (left-aligned title, short body,
 * right-aligned actions). It opens over the intro card when the switch is turned on, starts on Keep
 * off, and Escape keeps it off. A short preview shows what turning it on does; with the desktop cat on,
 * the cat closes the tab in the preview and the body says how to stop it.
 */
export function AutomaticCloseConfirmDialog({ onCancel, onConfirm, petEnabled = false, driftSource, windows = false, layer = "card" }: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly petEnabled?: boolean;
  readonly driftSource?: CloseConfirmSource | null;
  /** Draws Windows browser chrome in the preview. */
  readonly windows?: boolean;
  /** "card" sits over the intro card; "app" is an app-level modal (Settings), above the app shell. */
  readonly layer?: "card" | "app";
}) {
  const { t, effectiveLanguage } = useLocalization();
  const [petName] = usePetName();
  // A named cat is called by its name, the same way the real alert will call it.
  const catCancel = petName
    ? t("petName.catCancel", { petSubject: petNameAsSubject(petName, effectiveLanguage) })
    : t("postOnboarding.closeConfirm.catCancel");
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-intro-confirm-cancel]", explicitTabNavigation: true });
  useModalDismiss(onCancel);
  return (
    <div ref={dialogRef} className="guide-close-confirm" data-layer={layer} role="alertdialog" aria-modal="true"
      aria-labelledby="guide-close-confirm-title" aria-describedby="guide-close-confirm-description" tabIndex={-1}>
      <div className="guide-close-confirm__panel modal-shell" data-modal-variant="compact">
        <ClosePreview source={driftSource ?? FALLBACK_SOURCE} cat={petEnabled} catName={petEnabled ? petName : ""} windows={windows} />
        <div className="guide-close-confirm__head">
          <h2 id="guide-close-confirm-title">{t("postOnboarding.closeConfirm.title")}</h2>
          <span className="status-badge status-badge--beta">{t("common.beta")}</span>
        </div>
        <p id="guide-close-confirm-description">
          {t("postOnboarding.closeConfirm.body")}{petEnabled ? <> {catCancel}</> : null}
        </p>
        <p className="guide-close-confirm__warn"><AlertIcon />{t("postOnboarding.closeConfirm.unsaved")}</p>
        <div className="guide-close-confirm__actions">
          <button type="button" className="modal-btn modal-btn--ghost" data-intro-confirm-cancel onClick={onCancel}>{t("onboarding.extreme.keepOff")}<KeyHint shortcut="escape" /></button>
          <button type="button" className="modal-btn modal-btn--primary" data-intro-confirm-allow onClick={onConfirm}>{t("postOnboarding.closeConfirm.turnOn")}</button>
        </div>
      </div>
    </div>
  );
}

/** The site's own icon where the app has it, otherwise the drift dot. */
function SiteMark({ source, size = 12 }: { readonly source: CloseConfirmSource; readonly size?: number }) {
  const icon = useSiteIcon(source.siteDomain);
  return icon
    ? <img className="close-preview__favicon" src={icon} alt="" width={size} height={size} />
    : <b className="close-preview__dot" />;
}

/**
 * What Automatic close does, played once and held on the result: the drift tab is playing, it closes,
 * the work comes back and the app's own "Closed" notice appears. Without the cat the tab's close button
 * is pressed; with the cat on, the cat walks up, paws the tab shut and sits. Reduced motion shows the result.
 */
function ClosePreview({ source, cat, catName, windows }: { readonly source: CloseConfirmSource; readonly cat: boolean; readonly catName: string; readonly windows: boolean }) {
  const { t, effectiveLanguage } = useLocalization();
  const [beat, setBeat] = useState(() => (reducedMotion() ? 2 : 0));
  useEffect(() => {
    if (!cat || reducedMotion()) return undefined;
    const timers = [window.setTimeout(() => setBeat(1), 900), window.setTimeout(() => setBeat(2), 1700)];
    return () => timers.forEach(id => window.clearTimeout(id));
  }, [cat]);
  const catPhase = beat === 1 ? "paw" : beat === 2 ? "sit" : "idle";
  return <div className="close-preview" aria-hidden="true" data-cat={cat || undefined} data-platform={windows ? "windows" : "macos"}>
    <div className="close-preview__window">
      <div className="close-preview__bar">
        <span className="close-preview__lights"><i /><i /><i /></span>
        <span className="close-preview__tab close-preview__tab--work"><DocIcon /><i /></span>
        <span className="close-preview__tab close-preview__tab--drift"><SiteMark source={source} /><span>{source.label}</span><em><CloseGlyph /></em></span>
        <span className="close-preview__controls"><WindowControls /></span>
      </div>
      <div className="close-preview__page">
        <span className="close-preview__line" style={{ width: "42%" }} />
        <span className="close-preview__line close-preview__line--soft" style={{ width: "86%" }} />
        <span className="close-preview__line close-preview__line--soft" style={{ width: "72%" }} />
        <span className="close-preview__line close-preview__line--soft" style={{ width: "80%" }} />
        <span className="close-preview__video">
          <svg viewBox="0 0 16 16"><path d="M5.5 3.8 12 8l-6.5 4.2z" fill="currentColor" /></svg>
          <span className="close-preview__progress"><i /></span>
        </span>
      </div>
    </div>
    {cat ? <span className="close-preview__cat" data-beat={beat} style={IVORY_CAT_STYLE}>
      <PetModeCat phase={catPhase} facing="left" pawFrame={catPhase === "paw" ? PET_MODE_PAW_CONTACT_FRAME : 0} publishHitRegion={false} decorative />
    </span> : null}
    <div className="close-preview__toast">
      <SiteMark source={source} size={18} />
      <span><strong>{catName
        ? t("petName.toastTitle", { petSubject: petNameAsSubject(catName, effectiveLanguage), closed: source.label })
        : t("companion.copy.extremeNudgeTitle").replace("{closed}", source.label)}</strong><small>{t("postOnboarding.closeConfirm.backToWork")}</small></span>
    </div>
  </div>;
}

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
function AlertIcon() {
  return <svg className="guide-close-confirm__glyph" viewBox="0 0 16 16" aria-hidden="true" {...STROKE}><path d="M8 2.6 14 13H2z" /><path d="M8 6.6v2.9" /><circle cx="8" cy="11.2" r=".5" fill="currentColor" stroke="none" /></svg>;
}
function DocIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" {...STROKE} strokeWidth={1.4}><path d="M4 2.5h5.2L12 5.3v8.2H4z" /><path d="M6.2 8h3.6M6.2 10.4h3.6" /></svg>;
}
function WindowControls() {
  return <>
    <svg viewBox="0 0 10 10" aria-hidden="true" {...STROKE} strokeWidth={1.2}><path d="M1.5 5h7" /></svg>
    <svg viewBox="0 0 10 10" aria-hidden="true" {...STROKE} strokeWidth={1.2}><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg>
    <svg viewBox="0 0 10 10" aria-hidden="true" {...STROKE} strokeWidth={1.2}><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
  </>;
}
function CloseGlyph() {
  return <svg viewBox="0 0 10 10" aria-hidden="true" {...STROKE} strokeWidth={1.5}><path d="M2.6 2.6l4.8 4.8M7.4 2.6 2.6 7.4" /></svg>;
}
