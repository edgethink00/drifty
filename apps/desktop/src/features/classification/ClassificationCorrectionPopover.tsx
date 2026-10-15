import { CATEGORY_ORDER, PRODUCTIVITY_ORDER, type ActivityCategory, type ProductivityLabel } from "@drifty/domain";
import { useDeletedCategories } from "../settings/categoryCustomizationStore";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import type { LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import type { ClassificationCorrectionDraft, ClassificationCorrectionNotice } from "./classificationCorrection";
import { ActionLabel } from "../../components/ActionLabel";
import { ChevronRightIcon } from "../categories/definitionIcons";

export const CLASSIFICATION_CORRECTION_POPOVER_WIDTH = 296;
export const CLASSIFICATION_CORRECTION_POPOVER_GAP = 8;
export const CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING = 12;
/**
 * Height of the from → to row (10px margin + 28px row). It only appears once
 * something changed, so placement always counts it. A card that opens above its
 * pencil also keeps the row's space empty until then: otherwise the first pick
 * would either push the options up from under the pointer or leave the card
 * floating a row's height away from the pencil it belongs to.
 */
export const CLASSIFICATION_CORRECTION_CHANGE_ROW_HEIGHT = 38;

export type ClassificationCorrectionPopoverPlacement = {
  readonly left: number;
  readonly top: number;
  readonly side: "below" | "above";
};

type AnchorRectLike = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom" | "width" | "height">;

// The popover hangs off the pencil that opened it: right edges aligned, sitting
// just below the trigger, flipping above when the bottom of the viewport is
// closer than the card is tall. The list underneath never moves.
export function getClassificationCorrectionPopoverPlacement(
  anchor: AnchorRectLike,
  width: number,
  height: number,
  viewport: { readonly width: number; readonly height: number },
): ClassificationCorrectionPopoverPlacement {
  const pad = CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING;
  const gap = CLASSIFICATION_CORRECTION_POPOVER_GAP;
  const maxLeft = Math.max(pad, viewport.width - width - pad);
  const left = Math.min(Math.max(anchor.right - width, pad), maxLeft);
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - height;
  const fitsBelow = belowTop + height <= viewport.height - pad;
  const fitsAbove = aboveTop >= pad;
  const side: ClassificationCorrectionPopoverPlacement["side"] = fitsBelow || !fitsAbove ? "below" : "above";
  const preferredTop = side === "below" ? belowTop : aboveTop;
  const maxTop = Math.max(pad, viewport.height - height - pad);
  return { left, top: Math.min(Math.max(preferredTop, pad), maxTop), side };
}

/**
 * Where the card goes when its trigger is gone — a row that scrolled out of the
 * list, or a ref that never attached. The card stays hidden until it has a
 * placement, so without this an open editor would be invisible with no way to
 * tell it apart from a dead button.
 */
export function getClassificationCorrectionPopoverFallbackPlacement(
  width: number,
  height: number,
  viewport: { readonly width: number; readonly height: number },
): ClassificationCorrectionPopoverPlacement {
  const pad = CLASSIFICATION_CORRECTION_POPOVER_VIEWPORT_PADDING;
  const left = Math.min(Math.max((viewport.width - width) / 2, pad), Math.max(pad, viewport.width - width - pad));
  const top = Math.min(Math.max((viewport.height - height) / 2, pad), Math.max(pad, viewport.height - height - pad));
  return { left, top, side: "below" };
}

function moveRadioValue<T>(values: readonly T[], current: T, key: string): T | null {
  if (!values.length) return null;
  const index = Math.max(0, values.indexOf(current));
  if (key === "ArrowRight" || key === "ArrowDown") return values[(index + 1) % values.length] ?? current;
  if (key === "ArrowLeft" || key === "ArrowUp") return values[(index - 1 + values.length) % values.length] ?? current;
  if (key === "Home") return values[0] ?? current;
  if (key === "End") return values[values.length - 1] ?? current;
  return null;
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8h9.5M9 4.5L12.5 8 9 11.5" />
    </svg>
  );
}

export type ClassificationCorrectionPopoverProps = {
  readonly anchorElement: HTMLElement | null;
  readonly draft: ClassificationCorrectionDraft;
  readonly notice: ClassificationCorrectionNotice | null;
  readonly saving: boolean;
  readonly identity: ReactNode;
  readonly title: string;
  readonly scopeBadge: string;
  readonly scopeDescription: string;
  readonly ariaLabel: string;
  readonly originalCategory: ActivityCategory;
  readonly originalProductivity: ProductivityLabel;
  readonly t: LocalizationController["t"];
  readonly onCategoryChange: (category: ActivityCategory) => void;
  readonly onProductivityChange: (productivity: ProductivityLabel) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  /** Opens the category editor, for a category that is missing or needs a better description. */
  readonly onEditCategories?: () => void;
};

export function ClassificationCorrectionPopover({
  anchorElement,
  draft,
  notice,
  saving,
  identity,
  title,
  scopeBadge,
  scopeDescription,
  ariaLabel,
  originalCategory,
  originalProductivity,
  t,
  onCategoryChange,
  onProductivityChange,
  onSave,
  onCancel,
  onEditCategories,
}: ClassificationCorrectionPopoverProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<ClassificationCorrectionPopoverPlacement | null>(null);
  const isPositioned = placement !== null;
  const deletedCategories = useDeletedCategories();
  const categoryValues = CATEGORY_ORDER.filter((category) => category !== "unknown" && (!deletedCategories.has(category) || category === originalCategory));
  const changed = draft.category !== originalCategory || draft.productivity !== originalProductivity;

  const updatePlacement = useCallback(() => {
    if (!cardRef.current) return;
    const measured = cardRef.current.getBoundingClientRect().height;
    const rowCounted = changed || cardRef.current.dataset.reserveChange === "true";
    const height = rowCounted ? measured : measured + CLASSIFICATION_CORRECTION_CHANGE_ROW_HEIGHT;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (!anchorElement) {
      setPlacement(getClassificationCorrectionPopoverFallbackPlacement(CLASSIFICATION_CORRECTION_POPOVER_WIDTH, height, viewport));
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    setPlacement(getClassificationCorrectionPopoverPlacement(
      anchorRect,
      CLASSIFICATION_CORRECTION_POPOVER_WIDTH,
      height,
      viewport,
    ));
  }, [anchorElement, changed]);

  // Throttle scroll/resize repositioning to one layout read per frame so
  // fast-scrolling the panel body doesn't trigger dozens of redundant calls.
  const rafRef = useRef(0);
  const throttledUpdatePlacement = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updatePlacement);
  }, [updatePlacement]);

  useLayoutEffect(() => {
    updatePlacement();
    window.addEventListener("resize", throttledUpdatePlacement);
    // Scrolling the panel body moves the anchor; capture catches nested scrollers.
    window.addEventListener("scroll", throttledUpdatePlacement, true);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", throttledUpdatePlacement);
      window.removeEventListener("scroll", throttledUpdatePlacement, true);
    };
  }, [updatePlacement, throttledUpdatePlacement, notice]);

  // Wait until placement makes the card visible before focusing it. Coordinate
  // updates and category edits must not move focus again.
  useEffect(() => {
    if (!isPositioned) return;
    const card = cardRef.current;
    const selected = card?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');
    selected?.focus({ preventScroll: true });
    return () => {
      if (anchorElement?.isConnected && document.activeElement === document.body) {
        anchorElement.focus({ preventScroll: true });
      }
    };
  }, [isPositioned, anchorElement]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      if (anchorElement?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorElement, onCancel]);

  const style: CSSProperties = {
    "--correction-tone": CATEGORY_COLORS[draft.category],
    width: CLASSIFICATION_CORRECTION_POPOVER_WIDTH,
    left: placement?.left ?? 0,
    top: placement?.top ?? 0,
  } as CSSProperties;

  return createPortal(
    <div
      ref={cardRef}
      className="classification-correction"
      role="dialog"
      aria-label={ariaLabel}
      data-positioned={String(placement !== null)}
      data-side={placement?.side ?? "below"}
      data-reserve-change={String(!changed && placement?.side === "above")}
      style={style}
    >
      <header className="classification-correction__header">
        <span className="classification-correction__identity">{identity}</span>
        <div className="classification-correction__heading">
          <strong className="classification-correction__title" title={title}>{title}</strong>
          <span className="classification-correction__scope">{scopeBadge}</span>
        </div>
        <button type="button" className="classification-correction__close" aria-label={t("classification.correction.close")} onClick={onCancel} disabled={saving}>
          <CloseGlyph />
        </button>
      </header>

      <div className="classification-correction__section">
        <div className="classification-correction__section-head">
          <span className="classification-correction__section-label">{t("common.category")}</span>
          {onEditCategories ? (
            <button type="button" className="classification-correction__edit" aria-label={t("categoryEditor.edit")} aria-haspopup="dialog" onClick={onEditCategories} disabled={saving}>
              {t("categoryEditor.manage")}
              <ChevronRightIcon />
            </button>
          ) : null}
        </div>
        <div
          className="classification-correction__palette"
          role="radiogroup"
          aria-label={t("common.category")}
          onKeyDown={(event) => {
            const next = moveRadioValue(categoryValues, draft.category, event.key);
            if (!next || next === draft.category) return;
            event.preventDefault();
            onCategoryChange(next);
            const nextButton = event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`);
            nextButton?.focus({ preventScroll: true });
          }}
        >
          {categoryValues.map((category) => {
            const selected = category === draft.category;
            return (
              <button
                key={category}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={saving}
                className="classification-correction__chip"
                data-selected={String(selected)}
                data-value={category}
                style={{ "--chip-tone": CATEGORY_COLORS[category] } as CSSProperties}
                onClick={() => onCategoryChange(category)}
              >
                <i aria-hidden="true" />
                <span>{localizedCategoryLabel(category, t)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="classification-correction__section">
        <span className="classification-correction__section-label">{t("common.productivity")}</span>
        <div
          className="classification-correction__palette classification-correction__palette--productivity"
          role="radiogroup"
          aria-label={t("common.productivity")}
          onKeyDown={(event) => {
            const next = moveRadioValue(PRODUCTIVITY_ORDER, draft.productivity, event.key);
            if (!next || next === draft.productivity) return;
            event.preventDefault();
            onProductivityChange(next);
            const nextButton = event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next}"]`);
            nextButton?.focus({ preventScroll: true });
          }}
        >
          {PRODUCTIVITY_ORDER.map((productivity) => {
            const selected = productivity === draft.productivity;
            return (
              <button
                key={productivity}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                disabled={saving}
                className="classification-correction__chip"
                data-selected={String(selected)}
                data-value={productivity}
                style={{ "--chip-tone": PRODUCTIVITY_COLORS[productivity] } as CSSProperties}
                onClick={() => onProductivityChange(productivity)}
              >
                <i aria-hidden="true" />
                <span>{localizedProductivityLabel(productivity, t)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nothing to say until something changed: the selected chips already show
          the current classification, and Apply stays disabled. */}
      <div className="classification-correction__change-slot" aria-live="polite">
        {changed ? (
          <div className="classification-correction__change">
            <span className="classification-correction__change-from">
              {localizedCategoryLabel(originalCategory, t)} · {localizedProductivityLabel(originalProductivity, t)}
            </span>
            <ArrowGlyph />
            <span className="classification-correction__change-to">
              {localizedCategoryLabel(draft.category, t)} · {localizedProductivityLabel(draft.productivity, t)}
            </span>
          </div>
        ) : null}
      </div>

      {notice?.kind === "error" ? (
        <div className="classification-correction__notice classification-correction__notice--error" role="alert">
          {notice.message}
        </div>
      ) : null}

      <footer className="classification-correction__footer">
        <p className="classification-correction__scope-note">{scopeDescription}</p>
        <div className="classification-correction__actions">
          <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={onSave} disabled={saving || !changed} aria-busy={saving}>
            <ActionLabel busy={saving} busyLabel={t("classification.correction.applying")}>{t("classification.correction.apply")}</ActionLabel>
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
