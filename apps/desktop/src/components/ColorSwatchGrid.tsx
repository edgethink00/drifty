import { useEffect, useRef, type CSSProperties } from "react";
import { moveRovingFocus } from "../lib/rovingFocus";
import { normalizeHex } from "../lib/colorPalette";
import "./color-swatch-grid.css";

export type SwatchItem = {
  readonly color: string;
  /** Accessible name for the swatch. */
  readonly label: string;
  /** Who already uses this color, if anyone; rendered as a hollow ring. */
  readonly usedBy?: string;
};

type SwatchStyle = CSSProperties & { readonly "--swatch-color": string };

export function swatchStyle(color: string): SwatchStyle {
  return { "--swatch-color": color };
}

/**
 * The app's swatch language, shared by the project editor and Settings →
 * Appearance. Every state (hover, selected, used, focus) lives in box-shadow
 * so nothing changes size or position; a color already taken elsewhere keeps
 * its hue as a ring and drops its fill.
 */
export function ColorSwatchGrid({
  items,
  value,
  columns,
  ariaLabel,
  autoFocus = false,
  onPick,
  onHover,
}: {
  readonly items: readonly SwatchItem[];
  readonly value: string;
  readonly columns: number;
  readonly ariaLabel: string;
  /** Move focus to the selected swatch on mount (popovers). */
  readonly autoFocus?: boolean;
  readonly onPick: (color: string) => void;
  readonly onHover?: (item: SwatchItem | null) => void;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = normalizeHex(value);
  const hasSelected = items.some((item) => normalizeHex(item.color) === selected);

  useEffect(() => {
    if (!autoFocus) return;
    const root = rootRef.current;
    (root?.querySelector<HTMLButtonElement>("button[aria-checked='true']") ?? root?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={rootRef}
      className="color-swatch-grid"
      style={{ "--swatch-columns": String(columns) } as CSSProperties}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(event) => moveRovingFocus(event, columns)}
      onMouseLeave={() => onHover?.(null)}
    >
      {items.map((item, index) => {
        const isSelected = normalizeHex(item.color) === selected;
        const isUsed = !isSelected && Boolean(item.usedBy);
        return (
          <button
            key={item.color}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={isUsed ? `${item.label} · ${item.usedBy}` : item.label}
            className={`color-swatch${isSelected ? " is-selected" : ""}${isUsed ? " is-used" : ""}`}
            style={swatchStyle(item.color)}
            tabIndex={isSelected || (!hasSelected && index === 0) ? 0 : -1}
            onMouseEnter={() => onHover?.(item)}
            onFocus={() => onHover?.(item)}
            onClick={() => onPick(item.color)}
          >
            <svg className="color-swatch__check" viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
