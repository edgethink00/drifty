import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";

/** A trailing action button rendered inside an option row (e.g. Download, Delete, Show in Finder). */
export type SettingsSelectRowAction = {
  readonly key: string;
  /** Accessible name (aria-label + title). */
  readonly label: string;
  /** Visible text for a pill button (ignored when `icon` is set). */
  readonly text?: string;
  /** Visible compact icon; renders an icon button instead of a text pill. */
  readonly icon?: ReactNode;
  /** Reveal only on hover / focus (used for manage-style actions like Delete). */
  readonly onHover?: boolean;
  readonly tone?: "danger" | "primary";
  readonly disabled?: boolean;
  readonly busy?: boolean;
  readonly onAction: () => void;
};

export type SettingsSelectOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
  /** Optional customer-facing title, also used as the accessible option name. */
  readonly displayLabel?: string;
  readonly description?: string;
  /** Persistent state text beside the option title, separate from hover actions. */
  readonly statusLabel?: string;
  readonly accentColor?: string;
  readonly disabled?: boolean;
  /** Greyed as "not ready" but still clickable (e.g. a provider that needs API keys). */
  readonly muted?: boolean;
  readonly iconSrc?: string;
  /** Custom leading element (e.g. a tinted brand-mark badge). Takes precedence over iconSrc/dot. */
  readonly icon?: ReactNode;
  readonly actionLabel?: string;
  readonly actionAriaLabel?: string;
  readonly actionDisabled?: boolean;
  /** Reveal the row action only on hover / focus (used for manage-style actions like Delete). */
  readonly actionOnHover?: boolean;
  /** Visual tone for the row action button. */
  readonly actionBusy?: boolean;
  readonly actionTone?: "danger" | "primary";
  readonly onAction?: (value: TValue) => void;
  /** Multiple trailing actions. Takes precedence over the single actionLabel/onAction pair. */
  readonly actions?: readonly SettingsSelectRowAction[];
};

function rowActionsFor<TValue extends string>(option: SettingsSelectOption<TValue>): readonly SettingsSelectRowAction[] {
  if (option.actions) return option.actions;
  if (!option.onAction) return [];
  const onAction = option.onAction;
  return [{
    key: "action",
    label: option.actionAriaLabel ?? option.actionLabel ?? "",
    text: option.actionLabel,
    onHover: option.actionOnHover,
    tone: option.actionTone,
    disabled: option.actionDisabled,
    busy: option.actionBusy,
    onAction: () => onAction(option.value),
  }];
}

type SettingsSelectProps<TValue extends string> = {
  readonly ariaLabel: string;
  readonly value: TValue;
  readonly options: readonly SettingsSelectOption<TValue>[];
  readonly onChange: (value: TValue) => void;
  readonly className?: string;
  /** Optional compact visual for icon-only triggers. The accessible name still comes from `ariaLabel`. */
  readonly triggerVisual?: ReactNode;
  /** Shown (greyed) in the trigger when `value` matches no option — a "nothing selected yet" state. */
  readonly placeholder?: string;
};

type SettingsSelectStyle = CSSProperties & {
  readonly "--settings-select-accent"?: string;
};

function optionStyle(accentColor: string | undefined): SettingsSelectStyle {
  return accentColor ? { "--settings-select-accent": accentColor } : {};
}

export function SettingsSelect<TValue extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className,
  triggerVisual,
  placeholder,
}: SettingsSelectProps<TValue>) {
  const controlId = useId();
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const matchedOption = options.find((option) => option.value === value);
  const showPlaceholder = !matchedOption && placeholder != null;
  const selectedOption = matchedOption ?? options[0];
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => activeIndexForOptions(options, selectedIndex));

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target)) return;
      setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setActiveIndex(activeIndexForOptions(options, selectedIndex));
  }, [isOpen, options, selectedIndex]);

  if (!selectedOption) return null;

  const activeOption = options[activeIndex] ?? selectedOption;
  const rootClassName = ["settings-select-control", className].filter(Boolean).join(" ");
  const triggerLabel = triggerVisual ? `${ariaLabel}: ${selectedOption.label}` : ariaLabel;
  const optionId = (optionValue: TValue) => `${controlId}-option-${optionValue}`;

  function openMenu() {
    setActiveIndex(activeIndexForOptions(options, selectedIndex));
    setIsOpen(true);
  }

  function chooseOption(option: SettingsSelectOption<TValue>) {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setIsOpen(false);
  }

  function moveActiveIndex(direction: 1 | -1) {
    setActiveIndex((current) => nextEnabledIndex(options, current, direction));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (options.length === 0) return;

    const rowActionHasFocus = event.target instanceof Element
      && event.target.closest(".settings-select-control__option-action") != null;
    if (rowActionHasFocus) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (isOpen) moveActiveIndex(1);
        else openMenu();
        break;
      case "ArrowUp":
        event.preventDefault();
        if (isOpen) moveActiveIndex(-1);
        else openMenu();
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabledIndex(options));
        setIsOpen(true);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastEnabledIndex(options));
        setIsOpen(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isOpen) chooseOption(activeOption);
        else openMenu();
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setIsOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-open={isOpen ? "true" : undefined}
      data-has-accent={selectedOption.accentColor ? "true" : undefined}
      data-placeholder={showPlaceholder ? "true" : undefined}
      style={optionStyle(selectedOption.accentColor)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="settings-select-control__trigger"
        role="combobox"
        aria-label={triggerLabel}
        title={triggerVisual ? triggerLabel : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? optionId(activeOption.value) : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
      >
        {triggerVisual ? (
          <span className="settings-select-control__trigger-visual" aria-hidden="true">{triggerVisual}</span>
        ) : (
          <>
            <span className="settings-select-control__value">
              {showPlaceholder ? null : <OptionIcon option={selectedOption} />}
              <span>{showPlaceholder ? placeholder : selectedOption.displayLabel ?? selectedOption.label}</span>
            </span>
            <span className="settings-select-control__chevron" aria-hidden="true" />
          </>
        )}
      </button>
      {isOpen ? (
        <div className="settings-select-control__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => {
            const optionDisabled = option.disabled === true;
            const showsSelectedState = option.value === value && !optionDisabled;
            const isActive = index === activeIndex;
            const rowActions = rowActionsFor(option);
            const iconActionsOnly = rowActions.length > 0 && rowActions.every((action) => action.icon != null);
            return (
              <div
                key={option.value}
                className={`settings-select-control__option-row${rowActions.length > 0 ? " has-action" : ""}${iconActionsOnly ? " settings-select-control__option-row--icon-actions" : ""}`}
                data-disabled={optionDisabled ? "true" : undefined}
              >
                <button
                  id={optionId(option.value)}
                  type="button"
                  role="option"
                  aria-label={option.description || option.statusLabel ? (option.displayLabel ?? option.label) : undefined}
                  aria-describedby={[
                    option.statusLabel ? `${optionId(option.value)}-status` : null,
                    option.description ? `${optionId(option.value)}-description` : null,
                  ].filter(Boolean).join(" ") || undefined}
                  aria-selected={showsSelectedState}
                  aria-disabled={optionDisabled}
                  tabIndex={-1}
                  className={`settings-select-control__option${showsSelectedState ? " is-selected" : ""}${isActive ? " is-active" : ""}${optionDisabled ? " is-disabled" : ""}${option.muted ? " is-muted" : ""}`}
                  data-has-accent={option.accentColor ? "true" : undefined}
                  disabled={optionDisabled}
                  style={optionStyle(option.accentColor)}
                  onClick={() => chooseOption(option)}
                  onMouseEnter={() => {
                    if (!optionDisabled) setActiveIndex(index);
                  }}
                >
                  <OptionIcon option={option} />
                  <span className="settings-select-control__option-label">
                    <span className={option.statusLabel ? "settings-select-control__option-title-with-status" : undefined}>
                      <span>{option.displayLabel ?? option.label}</span>
                      {option.statusLabel ? (
                        <span className="settings-select-control__option-status" id={`${optionId(option.value)}-status`}>
                          {option.statusLabel}
                        </span>
                      ) : null}
                    </span>
                    {option.description ? <span className="settings-select-control__option-description" id={`${optionId(option.value)}-description`}>{option.description}</span> : null}
                  </span>
                </button>
                {rowActions.length > 0 ? (
                  <span className="settings-select-control__option-actions">
                    {rowActions.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        className={`settings-select-control__option-action${action.icon ? " settings-select-control__option-action--icon" : ""}${action.onHover ? " settings-select-control__option-action--hover" : ""}${action.tone ? ` settings-select-control__option-action--${action.tone}` : ""}`}
                        aria-label={action.label}
                        title={action.label}
                        disabled={action.disabled}
                        aria-busy={action.busy || undefined}
                        onFocus={() => setActiveIndex(index)}
                        onClick={(event) => {
                          event.stopPropagation();
                          // Async actions can disable or replace this button. Keep
                          // focus inside the control so blur does not dismiss progress.
                          triggerRef.current?.focus({ preventScroll: true });
                          action.onAction();
                        }}
                      >
                        {action.icon ?? action.text}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function OptionIcon<TValue extends string>({ option }: { readonly option: SettingsSelectOption<TValue> }) {
  if (option.icon) {
    return <>{option.icon}</>;
  }
  if (option.iconSrc) {
    return <img className="settings-select-control__icon" src={option.iconSrc} alt="" aria-hidden="true" />;
  }
  return <span className="settings-select-control__dot" aria-hidden="true" />;
}

function activeIndexForOptions<TValue extends string>(
  options: readonly SettingsSelectOption<TValue>[],
  selectedIndex: number,
): number {
  const selectedOption = options[selectedIndex];
  if (selectedOption && !selectedOption.disabled) return selectedIndex;
  return firstEnabledIndex(options);
}

function firstEnabledIndex<TValue extends string>(options: readonly SettingsSelectOption<TValue>[]): number {
  const index = options.findIndex((option) => !option.disabled);
  return index >= 0 ? index : 0;
}

function lastEnabledIndex<TValue extends string>(options: readonly SettingsSelectOption<TValue>[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return 0;
}

function nextEnabledIndex<TValue extends string>(
  options: readonly SettingsSelectOption<TValue>[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return currentIndex;
  for (let step = 1; step <= options.length; step += 1) {
    const nextIndex = (currentIndex + (direction * step) + options.length) % options.length;
    if (!options[nextIndex]?.disabled) return nextIndex;
  }
  return currentIndex;
}
