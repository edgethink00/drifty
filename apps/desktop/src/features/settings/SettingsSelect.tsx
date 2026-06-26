import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

export type SettingsSelectOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
  readonly accentColor?: string;
  readonly disabled?: boolean;
  readonly iconSrc?: string;
  readonly actionLabel?: string;
  readonly actionAriaLabel?: string;
  readonly actionDisabled?: boolean;
  readonly onAction?: (value: TValue) => void;
};

type SettingsSelectProps<TValue extends string> = {
  readonly ariaLabel: string;
  readonly value: TValue;
  readonly options: readonly SettingsSelectOption<TValue>[];
  readonly onChange: (value: TValue) => void;
  readonly className?: string;
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
}: SettingsSelectProps<TValue>) {
  const controlId = useId();
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
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
      case "Tab":
        setIsOpen(false);
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-open={isOpen ? "true" : undefined}
      data-has-accent={selectedOption.accentColor ? "true" : undefined}
      style={optionStyle(selectedOption.accentColor)}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="settings-select-control__trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? optionId(activeOption.value) : undefined}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
      >
        <span className="settings-select-control__value">
          <OptionIcon option={selectedOption} />
          <span>{selectedOption.label}</span>
        </span>
        <span className="settings-select-control__chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="settings-select-control__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => {
            const optionDisabled = option.disabled === true;
            const showsSelectedState = option.value === value && !optionDisabled;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value}
                className={`settings-select-control__option-row${option.onAction ? " has-action" : ""}`}
                data-disabled={optionDisabled ? "true" : undefined}
              >
                <button
                  id={optionId(option.value)}
                  type="button"
                  role="option"
                  aria-selected={showsSelectedState}
                  aria-disabled={optionDisabled}
                  className={`settings-select-control__option${showsSelectedState ? " is-selected" : ""}${isActive ? " is-active" : ""}${optionDisabled ? " is-disabled" : ""}`}
                  data-has-accent={option.accentColor ? "true" : undefined}
                  disabled={optionDisabled}
                  style={optionStyle(option.accentColor)}
                  onClick={() => chooseOption(option)}
                  onMouseEnter={() => {
                    if (!optionDisabled) setActiveIndex(index);
                  }}
                >
                  <OptionIcon option={option} />
                  <span className="settings-select-control__option-label">{option.label}</span>
                  <span className="settings-select-control__check" aria-hidden="true" />
                </button>
                {option.onAction ? (
                  <button
                    type="button"
                    className="settings-select-control__option-action"
                    aria-label={option.actionAriaLabel ?? option.actionLabel}
                    disabled={option.actionDisabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      option.onAction?.(option.value);
                    }}
                  >
                    {option.actionLabel}
                  </button>
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
