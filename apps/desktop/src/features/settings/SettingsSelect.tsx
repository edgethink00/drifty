import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";

export type SettingsSelectOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
  readonly accentColor?: string;
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
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

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
    if (!isOpen) setActiveIndex(selectedIndex);
  }, [isOpen, selectedIndex]);

  if (!selectedOption) return null;

  const activeOption = options[activeIndex] ?? selectedOption;
  const rootClassName = ["settings-select-control", className].filter(Boolean).join(" ");
  const optionId = (optionValue: TValue) => `${controlId}-option-${optionValue}`;

  function openMenu() {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  }

  function chooseOption(option: SettingsSelectOption<TValue>) {
    if (option.value !== value) onChange(option.value);
    setIsOpen(false);
  }

  function moveActiveIndex(direction: 1 | -1) {
    setActiveIndex((current) => {
      const next = current + direction;
      if (next < 0) return options.length - 1;
      if (next >= options.length) return 0;
      return next;
    });
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
        setActiveIndex(0);
        setIsOpen(true);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
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
          <span className="settings-select-control__dot" aria-hidden="true" />
          <span>{selectedOption.label}</span>
        </span>
        <span className="settings-select-control__chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="settings-select-control__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={option.value}
                id={optionId(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`settings-select-control__option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                data-has-accent={option.accentColor ? "true" : undefined}
                style={optionStyle(option.accentColor)}
                onClick={() => chooseOption(option)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="settings-select-control__dot" aria-hidden="true" />
                <span className="settings-select-control__option-label">{option.label}</span>
                <span className="settings-select-control__check" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
