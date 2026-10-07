import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActivityCategory } from "@drifty/domain";
import { SettingsSelect } from "./SettingsSelect";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";
import { ColorSwatchGrid, swatchStyle, type SwatchItem } from "../../components/ColorSwatchGrid";
import { BALANCED_PRESETS, normalizeHex, presetForColor, type BalancedPresetId } from "../../lib/colorPalette";

export type AppThemeColorKey = "accent" | "productivityFocus" | "productivityDrift" | "productivityNeutral";

export type ColorOption<TKey extends string> = {
  readonly key: TKey;
  readonly label: string;
  readonly cssVariable: string;
  readonly defaultColor: string;
};

type CategoryColorControlsProps = {
  readonly options: readonly ColorOption<ActivityCategory>[];
  readonly overrides: Partial<Record<ActivityCategory, string>>;
  readonly onColorChange: (key: ActivityCategory, value: string) => void;
  readonly onColorReset: (key: ActivityCategory) => void;
};

type ThemeColorControlsProps = {
  readonly accentOptions: readonly ColorOption<AppThemeColorKey>[];
  readonly productivityOptions: readonly ColorOption<AppThemeColorKey>[];
  readonly overrides: Partial<Record<AppThemeColorKey, string>>;
  readonly onColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onColorReset: (key: AppThemeColorKey) => void;
};

type ClassificationPickerProps<TValue extends string> = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: TValue;
  readonly options: readonly TValue[];
  readonly getLabel: (value: TValue) => string;
  readonly getColor: (value: TValue) => string;
  readonly onChange: (value: TValue) => void;
  readonly variant?: "category" | "productivity";
};

const PALETTE_COLUMNS = 11;
/** Matches .settings-color-popover min-width; used to decide which edge to anchor to. */
const POPOVER_MIN_WIDTH_PX = 22 * 16;

function activeColor<TKey extends string>(option: ColorOption<TKey>, overrides: Partial<Record<TKey, string>>): string {
  return overrides[option.key] ?? option.defaultColor;
}

function presetNameKey(id: BalancedPresetId): `settings.appearance.preset.${BalancedPresetId}` {
  return `settings.appearance.preset.${id}`;
}

function presetName(color: string, t: LocalizationController["t"]): string {
  const preset = presetForColor(color);
  return preset ? t(presetNameKey(preset.id)) : normalizeHex(color);
}

/**
 * One color role: a chip showing its current color, and an anchored palette
 * that opens under it. Colors already used by a sibling role render as rings
 * — distinguishability is the whole reason these colors exist.
 */
function ColorRoleChip<TKey extends string>({
  option,
  value,
  siblings,
  ariaType,
  isOpen,
  showValue,
  alignEnd,
  onToggle,
  onClose,
  onColorChange,
  onColorReset,
}: {
  readonly option: ColorOption<TKey>;
  readonly value: string;
  readonly siblings: ReadonlyMap<string, string>;
  readonly ariaType: string;
  readonly isOpen: boolean;
  /** Single-role rows show the value (color name) instead of the role name. */
  readonly showValue: boolean;
  readonly alignEnd: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly onColorChange: (key: TKey, value: string) => void;
  readonly onColorReset: (key: TKey) => void;
}) {
  const { t } = useLocalization();
  const [hovered, setHovered] = useState<SwatchItem | null>(null);
  const roleRef = useRef<HTMLDivElement | null>(null);
  // A chip near the right edge anchors its palette to its own right edge, so
  // the last categories in a row never push the page sideways.
  const [flipToEnd, setFlipToEnd] = useState(false);
  useLayoutEffect(() => {
    if (!isOpen || alignEnd) return;
    const rect = roleRef.current?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    if (rect && viewportWidth > 0) setFlipToEnd(rect.left + POPOVER_MIN_WIDTH_PX > viewportWidth - 16);
  }, [isOpen, alignEnd]);
  const isOverridden = normalizeHex(value) !== normalizeHex(option.defaultColor);
  const items: SwatchItem[] = BALANCED_PRESETS.map((preset) => {
    const owner = siblings.get(preset.color);
    return {
      color: preset.color,
      label: t("settings.appearance.colorPresetAria", { label: option.label, preset: t(presetNameKey(preset.id)) }),
      usedBy: owner ? t("settings.appearance.usedByRole", { label: owner }) : undefined,
    };
  });
  const shownColor = hovered?.color ?? value;
  const shownName = hovered ? presetName(hovered.color, t) : presetName(value, t);
  const valueLabel = presetName(value, t);

  return (
    <div className={`settings-color-role${isOpen ? " is-open" : ""}`} ref={roleRef}>
      <button
        type="button"
        className={`settings-color-chip${isOverridden ? " is-overridden" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={showValue ? `${option.label} · ${valueLabel}` : undefined}
        onClick={onToggle}
      >
        <span className="settings-color-chip__dot" style={swatchStyle(value)} aria-hidden="true" />
        <span className="settings-color-chip__label">{showValue ? valueLabel : option.label}</span>
        <span className="settings-color-chip__chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          className={`settings-color-popover${alignEnd || flipToEnd ? " settings-color-popover--end" : ""}`}
          role="dialog"
          aria-label={t("settings.appearance.colorPaletteAria", { label: option.label })}
        >
          <ColorSwatchGrid
            items={items}
            value={value}
            columns={PALETTE_COLUMNS}
            ariaLabel={t("settings.appearance.presetColorsAria", { label: option.label })}
            autoFocus
            onHover={setHovered}
            onPick={(color) => {
              onColorChange(option.key, color);
              onClose();
            }}
          />
          <div className="settings-color-popover__footer">
            <span className="settings-color-current">
              <span className="settings-color-chip__dot" style={swatchStyle(shownColor)} aria-hidden="true" />
              <span>{shownName}</span>
              {hovered?.usedBy ? <span className="settings-color-current__owner">{hovered.usedBy}</span> : null}
            </span>
            <label className="settings-color-more">
              <input
                type="color"
                aria-label={t("settings.appearance.customColorAria", { label: option.label, type: ariaType })}
                value={value}
                onChange={(event) => onColorChange(option.key, event.currentTarget.value)}
              />
              <span>{t("settings.appearance.moreColors")}</span>
            </label>
            <button
              type="button"
              className="settings-color-default"
              disabled={!isOverridden}
              aria-label={t("settings.appearance.setDefaultAria", { label: option.label })}
              onClick={() => {
                onColorReset(option.key);
                onClose();
              }}
            >
              {t("settings.appearance.defaultColor")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A settings row of color roles. At rest it is just the chips — a legend of
 * what the colors currently are. One chip opens one palette; nothing reflows.
 */
function ColorRoleRow<TKey extends string>({
  settingId,
  title,
  ariaLabel,
  description,
  options,
  overrides,
  ariaType,
  inline = false,
  onColorChange,
  onColorReset,
}: {
  readonly settingId: string;
  readonly title: string;
  /** Group name for assistive tech; defaults to the title. */
  readonly ariaLabel?: string;
  /** Optional: chip-only rows are self-explanatory (the palette names who uses a ring colour). */
  readonly description?: string;
  readonly options: readonly ColorOption<TKey>[];
  readonly overrides: Partial<Record<TKey, string>>;
  readonly ariaType: string;
  /** Single-role rows sit on the right like a select, showing their value. */
  readonly inline?: boolean;
  readonly onColorChange: (key: TKey, value: string) => void;
  readonly onColorReset: (key: TKey) => void;
}) {
  const [openKey, setOpenKey] = useState<TKey | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openKey === null) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenKey(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      rootRef.current?.querySelector<HTMLButtonElement>(".settings-color-chip[aria-expanded='true']")?.focus();
      setOpenKey(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openKey]);

  return (
    <div
      data-setting-id={settingId}
      className={inline ? "settings-row settings-color-row settings-color-row--inline" : "settings-row settings-row--fallback settings-color-row"}
      role="group"
      aria-label={ariaLabel ?? title}
    >
      <div>
        <div className="lbl">{title}</div>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      <div className={inline ? "ctrl" : "ctrl settings-row__actions settings-color-editor"}>
        <div className="settings-color-roles" ref={rootRef}>
          {options.map((option) => {
            const siblings = new Map<string, string>();
            for (const other of options) {
              if (other.key !== option.key) siblings.set(normalizeHex(activeColor(other, overrides)), other.label);
            }
            return (
              <ColorRoleChip
                key={option.key}
                option={option}
                value={activeColor(option, overrides)}
                siblings={siblings}
                ariaType={ariaType}
                isOpen={openKey === option.key}
                showValue={inline}
                alignEnd={inline}
                onToggle={() => setOpenKey((current) => (current === option.key ? null : option.key))}
                onClose={() => setOpenKey(null)}
                onColorChange={onColorChange}
                onColorReset={onColorReset}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CategoryColorControls({ options, overrides, onColorChange, onColorReset }: CategoryColorControlsProps) {
  const { t } = useLocalization();
  return (
    <ColorRoleRow
      settingId="settings.appearance.categoryColors"
      title={t("settings.appearance.categoryColors")}
      options={options.map((option) => ({ ...option, label: localizedCategoryLabel(option.key, t) }))}
      overrides={overrides}
      ariaType="category"
      onColorChange={onColorChange}
      onColorReset={onColorReset}
    />
  );
}

/** Accent: a single role, so it sits on the right like the theme select. */
export function AccentColorControl({ accentOptions, overrides, onColorChange, onColorReset }: Omit<ThemeColorControlsProps, "productivityOptions">) {
  const { t } = useLocalization();
  return (
    <ColorRoleRow
      settingId="settings.appearance.accent"
      title={t("settings.appearance.accent")}
      ariaLabel={t("settings.appearance.accentColor")}
      description={t("settings.appearance.accentDescription")}
      options={accentOptions.map((option) => ({ ...option, label: localizedThemeColorOptionLabel(option.key, option.label, t) }))}
      overrides={overrides}
      ariaType="theme"
      inline
      onColorChange={onColorChange}
      onColorReset={onColorReset}
    />
  );
}

export function ProductivityColorControls({ productivityOptions, overrides, onColorChange, onColorReset }: Omit<ThemeColorControlsProps, "accentOptions">) {
  const { t } = useLocalization();
  return (
    <ColorRoleRow
      settingId="settings.appearance.productivityColors"
      title={t("settings.appearance.productivityColors")}
      options={productivityOptions.map((option) => ({ ...option, label: localizedThemeColorOptionLabel(option.key, option.label, t) }))}
      overrides={overrides}
      ariaType="theme"
      onColorChange={onColorChange}
      onColorReset={onColorReset}
    />
  );
}

function localizedThemeColorOptionLabel(
  key: AppThemeColorKey,
  fallback: string,
  t: LocalizationController["t"],
): string {
  switch (key) {
    case "accent": return t("settings.appearance.accent");
    case "productivityFocus": return localizedProductivityLabel("focus", t);
    case "productivityDrift": return localizedProductivityLabel("drift", t);
    case "productivityNeutral": return localizedProductivityLabel("neutral", t);
    default: return fallback;
  }
}

export function ClassificationPicker<TValue extends string>({ label, ariaLabel, value, options, getLabel, getColor, onChange, variant = "category" }: ClassificationPickerProps<TValue>) {
  return (
    <label className={`classification-rule-field classification-rule-picker-field classification-rule-picker-field--${variant}`}>
      <span>{label}</span>
      <SettingsSelect
        ariaLabel={ariaLabel}
        className="classification-rule-select"
        menuSize={variant === "category" ? "content" : "bounded"}
        value={value}
        options={options.map((option) => ({ value: option, label: getLabel(option), accentColor: getColor(option) }))}
        onChange={onChange}
      />
    </label>
  );
}
