import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { clipPetName, normalizePetName, petNameAsSubject } from "../../pet-mode/petName";
import { useLocalization } from "../../localization/LocalizationContext";
import { PET_NAME_SUGGESTIONS } from "../../localization/petNameTranslations";

type Placement = { readonly style: CSSProperties; readonly arrow: number; readonly below: boolean };

/**
 * Asks for the cat's name right after the cat is turned on. It sits beside the cat row over the
 * illustration (below the row when the card is stacked) inside the intro panel, so the panel's focus
 * trap keeps working. Nothing is named until the user confirms a name they typed or picked: the field
 * starts empty, no idea is preselected, and confirming stays off until there is a name.
 */
export function GuidePetNamePopover({ panelRef, initialName, site, onConfirm, onLater }: {
  readonly panelRef: RefObject<HTMLDivElement | null>;
  readonly initialName: string;
  /** The site the preview line names as closed: the day's biggest drift, or a familiar video site. */
  readonly site: string;
  readonly onConfirm: (name: string) => void;
  readonly onLater: () => void;
}) {
  const { t, effectiveLanguage } = useLocalization();
  const [draft, setDraft] = useState(initialName);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const name = normalizePetName(draft);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const pop = popRef.current;
    if (!panel || !pop) return undefined;
    const place = () => {
      const row = panel.querySelector<HTMLElement>(".post-onboarding-sidebar-guide__copy-inner .guide-decision__row--pet");
      if (!row) return;
      const p = panel.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const below = p.width < 540;
      if (below) {
        setPlacement({ below, arrow: 28, style: { left: r.left - p.left, top: r.bottom - p.top + 10, width: r.width } });
        return;
      }
      const height = pop.offsetHeight;
      const center = r.top - p.top + r.height / 2;
      const top = Math.max(12, Math.min(center - height / 2, p.height - height - 12));
      setPlacement({ below, arrow: center - top, style: { left: r.right - p.left + 14, top } });
    };
    // In a long language the cat row can sit below the card's scrolling copy; bring it into view first.
    panel.querySelector<HTMLElement>(".post-onboarding-sidebar-guide__copy-inner .guide-decision__row--pet")?.scrollIntoView?.({ block: "nearest" });
    place();
    const scroller = panel.querySelector<HTMLElement>(".post-onboarding-sidebar-guide__copy");
    scroller?.addEventListener("scroll", place, { passive: true });
    if (typeof ResizeObserver === "undefined") return () => scroller?.removeEventListener("scroll", place);
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    // The popover grows when the preview wraps; keep it inside the card as it does.
    observer.observe(pop);
    return () => { observer.disconnect(); scroller?.removeEventListener("scroll", place); };
  }, [panelRef]);

  // Focus the field once the popover has its place: a hidden field cannot take focus.
  const focused = useRef(false);
  useEffect(() => {
    if (!placement || focused.current) return;
    focused.current = true;
    inputRef.current?.focus();
  }, [placement]);
  // While it is open, Escape closes the popover wherever focus is, and never the whole intro.
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onLaterRef.current();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, []);

  return (
    <div ref={popRef} className="guide-name-pop" role="dialog" aria-labelledby={titleId}
      data-placement={placement?.below ? "below" : "side"}
      style={placement ? { ...placement.style, ["--guide-name-pop-arrow" as string]: placement.arrow + "px" } : { visibility: "hidden" }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === inputRef.current) {
          event.preventDefault(); event.stopPropagation();
          if (name) onConfirm(name);
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Enter") event.stopPropagation();
      }}>
      <p id={titleId} className="guide-name-pop__title">{t("petName.popoverTitle")}</p>
      <input ref={inputRef} className="guide-name-pop__input" type="text" value={draft} autoComplete="off" spellCheck={false}
        placeholder={t("petName.placeholder")} aria-label={t("petName.inputLabel")}
        onChange={(event) => setDraft(clipPetName(event.target.value))} />
      <div className="guide-name-pop__ideas">
        <span className="guide-name-pop__ideas-label">{t("petName.ideas")}</span>
        {PET_NAME_SUGGESTIONS[effectiveLanguage].map((idea) => (
          <button key={idea} type="button" className="guide-name-pop__idea" aria-pressed={name === idea}
            onClick={() => { setDraft(idea); inputRef.current?.focus(); }}>{idea}</button>
        ))}
      </div>
      <p className="guide-name-pop__preview" aria-live="polite">
        {name
          ? <><span className="guide-name-pop__preview-dot" aria-hidden="true" />{t("petName.previewLabel")}<b>{t("petName.toastTitle", { petSubject: petNameAsSubject(name, effectiveLanguage), closed: site })}</b></>
          : t("petName.previewEmpty")}
      </p>
      <div className="guide-name-pop__actions">
        <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={onLater}>{t("petName.later")}</button>
        <button type="button" className="app-btn app-btn--primary app-btn--compact" disabled={!name} onClick={() => onConfirm(name)}>{t("petName.confirm")}</button>
      </div>
    </div>
  );
}
