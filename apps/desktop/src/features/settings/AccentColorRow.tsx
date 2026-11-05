import { useEffect, useRef, useState, type CSSProperties } from "react";
import { darkAccentTone } from "../../lib/accentTone";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedAccentLabel } from "../pro-looks/proLookCatalog";
import { ProLookLockBadge, ProLookPopover, ProLookRowNote } from "../pro-looks/ProLookViews";
import { accentLookId, ACCENT_SWATCHES, CUSTOM_ACCENT, DEFAULT_ACCENT, type ProLook } from "../pro-looks/proLooks";
import { useProLooks } from "../pro-looks/useProLooksController";
import { contrastingInk } from "./settingsStorage";

type AccentColorRowProps = {
  /** The saved accent (a hex); unset is the built-in Moss. */
  readonly accent: string | undefined;
  readonly onAccentChange: (color: string) => void;
  readonly onAccentReset: () => void;
};

const LISTED = new Set(ACCENT_SWATCHES.map((swatch) => swatch.color));

function swatchStyle(color: string): CSSProperties {
  return {
    "--swatch-color": color,
    "--swatch-color-dark": darkAccentTone(color),
    "--swatch-ink": contrastingInk(color),
  } as CSSProperties;
}

function CheckGlyph() {
  return (
    <svg className="accent-swatch__check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * The accent color, spread out in its row: Moss and Charcoal are free, every
 * other color and "More colors" are Pro looks (features/pro-looks). Picking a
 * locked color tries it on across the app while its bubble is open, as a
 * locked Dock icon or coat does. Circles shrink to keep one line on narrow
 * windows; in dark mode each shows the lighter tone the app paints.
 */
export function AccentColorRow({ accent, onAccentChange, onAccentReset }: AccentColorRowProps) {
  const { t } = useLocalization();
  const looks = useProLooks();
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  // An accent try-on repaints the whole app, so leaving Settings any way at all
  // (including a keyboard shortcut) ends it rather than carrying it along.
  const latestLooks = useRef(looks);
  latestLooks.current = looks;
  useEffect(() => () => {
    const current = latestLooks.current;
    if (current?.popover?.look.kind === "accent") current.closePopover();
  }, []);
  const current = looks?.accent ?? accentLookId(accent);
  // A color outside the row (Fern, Coral or the person's own) stays visible while it is
  // in use, and so does one kept from before accents were locked.
  const extras = [current, looks?.keptAccent ?? null]
    .filter((color, index, all): color is string => color !== null && !LISTED.has(color) && all.indexOf(color) === index);
  const colors = [...ACCENT_SWATCHES.map((swatch) => swatch.color), ...extras];
  const customLook: ProLook = { kind: "accent", id: CUSTOM_ACCENT };
  // The native picker only opens once every color is open; otherwise the custom
  // swatch behaves like any locked look (or waits while the plan loads).
  const customOpen = !looks || looks.access.state === "open";
  const customLocked = looks?.isLocked(customLook) ?? false;
  const customName = t("settings.appearance.moreColors");
  const customLabel = customLocked ? t("settings.proLooks.lockedLabel", { name: customName }) : customName;

  const choose = (color: string) => {
    if (looks) looks.pick({ kind: "accent", id: color });
    else if (color === DEFAULT_ACCENT) onAccentReset();
    else onAccentChange(color);
  };

  return (
    <div
      ref={setRow}
      data-setting-id="settings.appearance.accent"
      className="settings-row settings-row--accent"
      role="group"
      aria-label={t("settings.appearance.accentColor")}
    >
      <div>
        <div className="lbl">{t("settings.appearance.accent")}</div>
      </div>
      <div className="ctrl">
        <div
          className="accent-picker"
          role="radiogroup"
          aria-label={t("settings.appearance.accent")}
          style={{ "--accent-count": colors.length + 1 } as CSSProperties}
        >
          {colors.map((color) => {
            const look: ProLook = { kind: "accent", id: color };
            const name = localizedAccentLabel(color, t);
            const locked = looks?.isLocked(look) ?? false;
            const label = locked ? t("settings.proLooks.lockedLabel", { name }) : name;
            const isSelected = color === current;
            const tryingOn = looks?.preview?.kind === "accent" && looks.preview.id === color;
            return (
              <button
                key={color}
                type="button"
                className={"accent-swatch" + (isSelected ? " is-selected" : "") + (tryingOn ? " is-trying-on" : "")}
                role="radio"
                aria-checked={isSelected}
                aria-label={label}
                aria-haspopup={locked ? "dialog" : undefined}
                title={label}
                data-pro-look={"accent:" + color}
                style={swatchStyle(color)}
                onClick={() => choose(color)}
              >
                <CheckGlyph />
                {locked ? <ProLookLockBadge /> : null}
              </button>
            );
          })}
          {customOpen ? (
            <label className="accent-swatch accent-swatch--custom" title={customLabel}>
              <input
                type="color"
                aria-label={customLabel}
                value={current}
                onChange={(event) => onAccentChange(event.currentTarget.value)}
              />
            </label>
          ) : (
            <button
              type="button"
              className="accent-swatch accent-swatch--custom"
              aria-label={customLabel}
              aria-haspopup={customLocked ? "dialog" : undefined}
              title={customLabel}
              data-pro-look={"accent:" + CUSTOM_ACCENT}
              onClick={() => looks?.pick(customLook)}
            >
              {customLocked ? <ProLookLockBadge /> : null}
            </button>
          )}
        </div>
        {looks ? <ProLookRowNote looks={looks} kind="accent" /> : null}
      </div>
      {looks ? <ProLookPopover looks={looks} kind="accent" container={row} /> : null}
    </div>
  );
}
