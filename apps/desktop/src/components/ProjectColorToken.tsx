import { useState, type CSSProperties } from "react";

export type ProjectColorSwatch = {
  readonly color: string;
  readonly name: string;
};

type SwatchStyle = CSSProperties & {
  readonly "--settings-swatch-color": string;
};

function swatchStyle(color: string): SwatchStyle {
  return { "--settings-swatch-color": color };
}

/**
 * Project color control — the same trigger + preset-popover language as the
 * Settings → Appearance color tokens, reused by the personal and team project
 * editors. Styling lives in `styles/modal-chrome.css` (`.auth-modal
 * .settings-color-token`), self-scoped because the appearance rules and
 * control variables only apply under `.content--settings`.
 */
export function ProjectColorToken({
  value,
  swatches,
  usedColors,
  ariaLabel,
  onPick,
}: {
  readonly value: string;
  readonly swatches: readonly ProjectColorSwatch[];
  /** Colors taken by other projects — dimmed but still selectable. */
  readonly usedColors?: ReadonlySet<string>;
  readonly ariaLabel: string;
  readonly onPick: (color: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const name = swatches.find((swatch) => swatch.color === value)?.name ?? "Custom";

  return (
    <div className={`settings-color-token${open ? " is-open" : ""}`}>
      <button type="button" className="settings-color-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="settings-color-trigger__swatch" style={swatchStyle(value)} aria-hidden="true" />
        <span className="settings-color-trigger__copy">
          <span className="settings-color-token__name">{name}</span>
          <span className="settings-color-token__action">Change color</span>
        </span>
        <span className="settings-color-trigger__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="settings-color-popover">
          <div className="settings-color-token__presets" role="radiogroup" aria-label={ariaLabel}>
            {swatches.map((swatch) => {
              const isSelected = swatch.color === value;
              const isUsed = !isSelected && (usedColors?.has(swatch.color) ?? false);
              return (
                <button
                  key={swatch.color}
                  type="button"
                  className={`settings-color-preset${isSelected ? " is-selected" : ""}${isUsed ? " is-used" : ""}`}
                  style={swatchStyle(swatch.color)}
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`Color ${swatch.name}${isUsed ? " (already used)" : ""}`}
                  title={isUsed ? "Already used by another project" : swatch.name}
                  onClick={() => {
                    onPick(swatch.color);
                    setOpen(false);
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
