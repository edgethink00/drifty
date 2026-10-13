import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { getPetModeCoatSpec } from "../pet-mode/petModeData";
import { PetCoatSwatchCat } from "../settings/PetCoatSwatchCat";
import { trialDaysRemaining } from "../sidebar/SidebarCtaSlot";
import { APP_ICON_PREVIEWS, localizedProLookLabel } from "./proLookCatalog";
import { isKnownWithoutPro, sameLook, type ProLook, type ProLooksAccess } from "./proLooks";
import type { ProLooksController } from "./useProLooksController";
import "./proLooks.css";

function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5.3 7.3V5.7a2.7 2.7 0 0 1 5.4 0v1.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3.4" y="7" width="9.2" height="6.9" rx="1.9" fill="currentColor" />
    </svg>
  );
}

function OpenLockGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3.4" y="7" width="9.2" height="6.9" rx="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.3 7V5.4a2.7 2.7 0 0 1 5.2-1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      return look.kind === "icon" ? "settings.proLooks.iconGuest" : "settings.proLooks.coatGuest";
    case "trial-available":
      return "settings.proLooks.trialAvailable";
    case "unavailable":
      return "settings.proLooks.unavailable";
    default:
      return look.kind === "icon" ? "settings.proLooks.iconUpgrade" : "settings.proLooks.coatUpgrade";
  }
}

export function proLookTitle(look: ProLook, t: ReturnType<typeof useLocalization>["t"]): string {
  const name = localizedProLookLabel(look, t);
  return t(look.kind === "icon" ? "settings.proLooks.iconTitle" : "settings.proLooks.coatTitle", { name });
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
    ? t(look.kind === "icon" ? "settings.proLooks.iconPreviewTitle" : "settings.proLooks.coatPreviewTitle", { name })
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
          {t(look.kind === "icon" ? "settings.proLooks.iconPreviewHint" : "settings.proLooks.coatPreviewHint")}
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
 * One line under a picker: the trial keeps every look open (and for how long),
 * a look put away when Pro ended can come back, or a trial failed to start.
 */
export function ProLookRowNote({ looks, kind }: {
  readonly looks: ProLooksController;
  readonly kind: ProLook["kind"];
}) {
  const { t } = useLocalization();
  const access = looks.access;
  if (access.state === "open") {
    if (!access.trialing) return null;
    const days = trialDaysRemaining(access.trialEndsAt, Date.now());
    if (days === null || days < 1) return null;
    const left = t(days === 1 ? "sidebar.cta.trial.day" : "sidebar.cta.trial.days", { count: days });
    return (
      <p className="pro-look-note">
        <OpenLockGlyph />
        <span>{t(kind === "icon" ? "settings.proLooks.trialIconNote" : "settings.proLooks.trialCoatNote", { left })}</span>
      </p>
    );
  }
  if (looks.trialStartFailed === kind) {
    return <p className="pro-look-note" role="alert">{t("billing.trialActivation.failed")}</p>;
  }
  const putAway = kind === "icon" ? looks.reverted?.icon : looks.reverted?.coat;
  if (!putAway || !isKnownWithoutPro(access)) return null;
  const look: ProLook = kind === "icon"
    ? { kind: "icon", id: looks.reverted?.icon ?? "classic" }
    : { kind: "coat", id: looks.reverted?.coat ?? "ivory" };
  const actionKey = proLookActionKey(access);
  return (
    <p className="pro-look-note pro-look-note--put-away">
      <LockGlyph />
      <span>{t(kind === "icon" ? "settings.proLooks.iconPutAway" : "settings.proLooks.coatPutAway", { name: localizedProLookLabel(look, t) })}</span>
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
  const spec = getPetModeCoatSpec(look.id);
  return (
    <span
      className="pro-look-thumb pro-look-thumb--coat"
      aria-hidden="true"
      style={{ "--pet-coat-fur": spec.fur, "--pet-coat-ink": spec.ink } as CSSProperties}
    >
      <PetCoatSwatchCat />
    </span>
  );
}

