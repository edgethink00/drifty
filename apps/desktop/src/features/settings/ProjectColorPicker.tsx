import { useState } from "react";
import type { CSSProperties } from "react";
import { PROJECT_COLOR_PALETTE } from "./projectPalette";

type SwatchStyle = CSSProperties & Record<"--settings-swatch-color", string>;

function swatchStyle(color: string): SwatchStyle {
  return { "--settings-swatch-color": color };
}

function normalize(color: string): string {
  return color.trim().toLowerCase();
}

export interface ProjectColorPickerProps {
  readonly value: string;
  readonly onChange: (color: string) => void;
  /** Colors already taken by other projects — shown de-emphasized (still selectable). */
  readonly usedColors?: readonly string[];
}

/**
 * Preset-first project color picker, mirroring the Appearance tab's swatch +
 * "More colors" pattern. Colors used by other projects are dimmed so the user
 * is nudged toward a distinct one.
 */
export function ProjectColorPicker({ value, onChange, usedColors = [] }: ProjectColorPickerProps) {
  const [open, setOpen] = useState(false);
  const used = new Set(usedColors.map(normalize));
  const selected = normalize(value);

  return (
    <div className={`settings-color-token${open ? " is-open" : ""}`}>
      <button type="button" className="settings-color-trigger" aria-expanded={open} onClick={() => setOpen((prev) => !prev)}>
        <span className="settings-color-trigger__swatch" style={swatchStyle(value)} aria-hidden="true" />
        <span className="settings-color-trigger__copy">
          <span className="settings-color-token__name">Color</span>
          <span className="settings-color-token__action">Change color</span>
        </span>
        <span className="settings-color-trigger__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="settings-color-popover" aria-label="Project color palette">
          <div className="settings-color-token__presets" aria-label="Project preset colors">
            {PROJECT_COLOR_PALETTE.map((preset) => {
              const isSelected = selected === normalize(preset);
              const isUsed = !isSelected && used.has(normalize(preset));
              return (
                <button
                  key={preset}
                  type="button"
                  className={`settings-color-preset${isSelected ? " is-selected" : ""}${isUsed ? " is-used" : ""}`}
                  style={swatchStyle(preset)}
                  onClick={() => {
                    onChange(preset);
                    setOpen(false);
                  }}
                  aria-label={`Project color ${preset}${isUsed ? " (already used)" : ""}`}
                  title={isUsed ? "Already used by another project" : undefined}
                />
              );
            })}
          </div>
          <div className="settings-color-popover__footer">
            <span className="settings-color-main">
              <span style={swatchStyle(value)} aria-hidden="true" />
              <span>Main</span>
            </span>
            <label className="settings-color-more">
              <input type="color" aria-label="Custom project color" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
              <span>More colors</span>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}
