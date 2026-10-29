import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { darkAccentTone } from "../../lib/accentTone";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { getPetModeCoatSpec } from "../pet-mode/petModeData";
import { PetCoatSwatchCat } from "../settings/PetCoatSwatchCat";
import { APP_ICON_PREVIEWS, localizedProLookLabel } from "./proLookCatalog";
import { CUSTOM_ACCENT, isKnownWithoutPro, sameLook, type ProLook, type ProLooksAccess } from "./proLooks";
import type { ProLooksController } from "./useProLooksController";
import "./proLooks.css";

type LookCopy = {
  readonly title: TranslationKey;
  readonly previewTitle: TranslationKey;
  readonly guest: TranslationKey;
  readonly upgrade: TranslationKey;
  readonly previewHint: TranslationKey;
  readonly putAway: TranslationKey;
};

const LOOK_COPY: Readonly<Record<ProLook["kind"], LookCopy>> = {
  icon: {
    title: "settings.proLooks.iconTitle",
    previewTitle: "settings.proLooks.iconPreviewTitle",
    guest: "settings.proLooks.iconGuest",
    upgrade: "settings.proLooks.iconUpgrade",
    previewHint: "settings.proLooks.iconPreviewHint",
    putAway: "settings.proLooks.iconPutAway",
  },
  coat: {
    title: "settings.proLooks.coatTitle",
    previewTitle: "settings.proLooks.coatPreviewTitle",
    guest: "settings.proLooks.coatGuest",
    upgrade: "settings.proLooks.coatUpgrade",
    previewHint: "settings.proLooks.coatPreviewHint",
    putAway: "settings.proLooks.coatPutAway",
  },
  accent: {
    title: "settings.proLooks.accentTitle",
    previewTitle: "settings.proLooks.accentPreviewTitle",
    guest: "settings.proLooks.accentGuest",
    upgrade: "settings.proLooks.accentUpgrade",
    previewHint: "settings.proLooks.accentPreviewHint",
    putAway: "settings.proLooks.accentPutAway",
  },
};

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5.3 7.3V5.7a2.7 2.7 0 0 1 5.4 0v1.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3.4" y="7" width="9.2" height="6.9" rx="1.9" fill="currentColor" />
    </svg>
  );
}

/**
 * The lock on a Pro look the person cannot use yet: always visible at the
 * bottom-right corner, never hover-only, and the art itself is left as is.
 * White rounded square (owner pick, 2026-10-13 review board L5).
 */
export function ProLookLockBadge() {
  return (
    <span className="pro-look-lock" aria-hidden="true">
      <LockGlyph />
    </span>
  );
}

/** The bubble's main action for where the person stands. */
export function proLookActionKey(access: ProLooksAccess): TranslationKey | null {
  switch (access.state) {
    case "guest":
      return "settings.proLooks.signInTrial";
    case "trial-available":
      return "billing.trialActivation.start";
    case "upgrade":
      return "sidebar.cta.upgrade.action";
    case "unavailable":
      return "settings.proLooks.openAccount";
    default:
      return null;
  }
}

function bubbleBodyKey(look: ProLook, access: ProLooksAccess): TranslationKey {
  switch (access.state) {
    case "unknown":
      return "settings.proLooks.checking";
    case "guest":
      return LOOK_COPY[look.kind].guest;
    case "trial-available":
      return "settings.proLooks.trialAvailable";
    case "unavailable":
      return "settings.proLooks.unavailable";
    default:
      return LOOK_COPY[look.kind].upgrade;
  }
}

export function proLookTitle(look: ProLook, t: ReturnType<typeof useLocalization>["t"]): string {
  if (look.kind === "accent" && look.id === CUSTOM_ACCENT) return t("settings.proLooks.accentCustomTitle");
  const name = localizedProLookLabel(look, t);
  return t(LOOK_COPY[look.kind].title, { name });
}

/**
 * The bubble a locked look opens, anchored under the look it belongs to inside
 * its settings row. While it is open the look is tried on for real (the Dock
 * icon or the desktop pet), and closing it puts the saved look back.
 */
export function ProLookPopover({ looks, kind, container }: {
  readonly looks: ProLooksController;
  readonly kind: ProLook["kind"];
  readonly container: HTMLElement | null;
}) {
  const popover = looks.popover;
  if (!popover || popover.look.kind !== kind) return null;
  return (
    <ProLookBubble
      key={popover.look.kind + ":" + popover.look.id + ":" + popover.mode}
      looks={looks}
      look={popover.look}
      checking={popover.mode === "checking"}
      container={container}
    />
  );
}

type BubblePlacement = { readonly left: number; readonly top: number; readonly arrow: number; readonly above: boolean };

function ProLookBubble({ looks, look, checking, container }: {
  readonly looks: ProLooksController;
  readonly look: ProLook;
  readonly checking: boolean;
  readonly container: HTMLElement | null;
}) {
  const { t } = useLocalization();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<BubblePlacement | null>(null);
  const { closePopover } = looks;
  const tryingOn = !checking && sameLook(looks.preview, look);
  const name = localizedProLookLabel(look, t);
  const title = tryingOn
    ? t(LOOK_COPY[look.kind].previewTitle, { name })
    : proLookTitle(look, t);
  const actionKey = checking ? null : proLookActionKey(looks.access);

  useLayoutEffect(() => {
    const place = () => {
      const bubble = ref.current;
      if (!bubble || !container) return;
      const anchor = container.querySelector<HTMLElement>('[data-pro-look="' + look.kind + ":" + look.id + '"]');
      if (!anchor) return;
      const box = container.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const center = target.left - box.left + target.width / 2;
      const left = Math.max(0, Math.min(center - 28, box.width - width));
      const roomBelow = window.innerHeight - target.bottom;
      const above = roomBelow < height + 18 && target.top > height + 18;
      setPlacement({
        left,
        top: above ? target.top - box.top - height - 10 : target.bottom - box.top + 10,
        arrow: center - left,
        above,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [container, look.id, look.kind, title]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || ref.current?.contains(target) || target.closest("[data-pro-look]")) return;
      closePopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closePopover();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [closePopover]);

  return (
    <div
      ref={ref}
      className={"pro-look-popover" + (placement?.above ? " is-above" : "")}
      role="dialog"
      aria-labelledby={titleId}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement ? "visible" : "hidden",
        "--pro-look-arrow": (placement?.arrow ?? 24) + "px",
      } as CSSProperties}
    >
      <p className="pro-look-popover__title" id={titleId}>{title}</p>
      <p className="pro-look-popover__body">{t(bubbleBodyKey(look, looks.access))}</p>
      {tryingOn ? (
        <p className="pro-look-popover__body">
          {t(LOOK_COPY[look.kind].previewHint)}
        </p>
      ) : null}
      <div className="pro-look-popover__actions">
        <button type="button" className="pro-look-btn pro-look-btn--ghost" onClick={closePopover}>
          {t(tryingOn ? "settings.proLooks.goBack" : "settings.proLooks.close")}
        </button>
        {actionKey ? (
          <button type="button" className="pro-look-btn pro-look-btn--primary" onClick={looks.unlock}>{t(actionKey)}</button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One line under a picker, only when something changed: a look put away when
 * Pro ended can come back, or a trial failed to start. While Pro or a trial is
 * on, every look simply works and the picker says nothing about the plan;
 * the plan and the trial's end live in Settings › Account (2026-10-29).
 */
export function ProLookRowNote({ looks, kind }: {
  readonly looks: ProLooksController;
  readonly kind: ProLook["kind"];
}) {
  const { t } = useLocalization();
  const access = looks.access;
  if (access.state === "open") return null;
  if (looks.trialStartFailed === kind) {
    return <p className="pro-look-note" role="alert">{t("billing.trialActivation.failed")}</p>;
  }
  const reverted = looks.reverted;
  if (!isKnownWithoutPro(access) || !reverted) return null;
  let look: ProLook | null = null;
  if (kind === "icon" && reverted.icon) look = { kind: "icon", id: reverted.icon };
  else if (kind === "coat" && reverted.coat) look = { kind: "coat", id: reverted.coat };
  else if (kind === "accent" && reverted.accent) look = { kind: "accent", id: reverted.accent };
  if (!look) return null;
  const actionKey = proLookActionKey(access);
  return (
    <p className="pro-look-note pro-look-note--put-away">
      <LockGlyph />
      <span>{t(LOOK_COPY[kind].putAway, { name: localizedProLookLabel(look, t) })}</span>
      {actionKey ? (
        <button type="button" className="pro-look-note__action" onClick={() => looks.unlockReverted(kind)}>{t(actionKey)}</button>
      ) : null}
    </p>
  );
}

/** The look a Pro sheet was opened for, shown beside its header. */
export function ProLookThumbnail({ look }: { readonly look: ProLook }) {
  if (look.kind === "icon") {
    return (
      <span className="pro-look-thumb" aria-hidden="true">
        <img src={APP_ICON_PREVIEWS[look.id]} alt="" draggable={false} />
      </span>
    );
  }
  if (look.kind === "accent") {
    // A small app window painted in the accent: sidebar selection, a label and a toggle.
    const color = look.id === CUSTOM_ACCENT ? null : look.id;
    return (
      <span
        className={"pro-look-thumb pro-look-thumb--accent" + (color ? "" : " is-custom")}
        aria-hidden="true"
        style={color ? { "--look-accent": color, "--look-accent-dark": darkAccentTone(color) } as CSSProperties : undefined}
      >
        <span className="pro-look-thumb__side"><i className="is-on" /><i /><i /></span>
        <span className="pro-look-thumb__main"><i className="is-label" /><i /><i className="is-bar" /><i className="is-toggle" /></span>
      </span>
    );
  }
  const spec = getPetModeCoatSpec(look.id);
  return (
    <span
      className="pro-look-thumb pro-look-thumb--coat"
      aria-hidden="true"
      style={{ "--pet-coat-fur": spec.fur, "--pet-coat-ink": spec.ink } as CSSProperties}
    >
      <PetCoatSwatchCat coat={look.id} />
    </span>
  );
}

