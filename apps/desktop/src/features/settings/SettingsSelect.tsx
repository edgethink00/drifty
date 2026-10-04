import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { AnchoredPresence } from "../../components/AnchoredPresence";

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
  /** Reuse the app's page-header button treatment outside Settings. */
  readonly triggerVariant?: "default" | "header-action";
  /** Greys the whole control and blocks opening (e.g. a prerequisite is off). */
  readonly disabled?: boolean;
  /** Optional compact visual for icon-only triggers. The accessible name still comes from `ariaLabel`. */
  readonly triggerVisual?: ReactNode;
  /** Shown (greyed) in the trigger when `value` matches no option — a "nothing selected yet" state. */
  readonly placeholder?: string;
  /** Align the selected row with the trigger instead of opening below it. */
  readonly placement?: "below" | "selected";
  /** Show every option when the viewport permits, rather than capping at 320px. */
  readonly menuSize?: "bounded" | "content";
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
  triggerVariant = "default",
  disabled = false,
  triggerVisual,
  placeholder,
  placement = triggerVisual || triggerVariant === "header-action" ? "below" : "selected",
  menuSize = "bounded",
}: SettingsSelectProps<TValue>) {
  const controlId = useId();
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuWasOpen = useRef(false);
  const keyboardNavigation = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const matchedOption = options.find((option) => option.value === value);
  const showPlaceholder = !matchedOption && placeholder != null;
  const selectedOption = matchedOption ?? options[0];
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => activeIndexForOptions(options, selectedIndex));

  useEffect(() => {
    // A prerequisite turning off while the menu is open must not leave a
    // floating listbox over a control the user can no longer act on.
    if (disabled) setIsOpen(false);
  }, [disabled]);

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
    setActiveIndex((current) => isOpen && options[current] && !options[current].disabled
      ? current
      : activeIndexForOptions(options, selectedIndex));
  }, [isOpen, options, selectedIndex]);

  useLayoutEffect(() => {
    if (!isOpen || placement !== "selected") return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    const root = rootRef.current;
    if (!menu || !trigger || !root) return;

    function positionMenu() {
      if (!menu) return;
      // Presence starts scaled around the menu's right edge. DOM rects include
      // that transform (even before width is set), so measuring it would bake
      // the entrance pose into the final label position. Measure at rest, then
      // restore the CSS pose before paint so entry/exit motion stays intact.
      const { transform, transition } = menu.style;
      menu.style.transition = "none";
      menu.style.transform = "none";
      try {
        measureMenuPosition();
      } finally {
        menu.style.transform = transform;
        // Flush the restored pose while transitions are off: otherwise the
        // browser can animate from the temporary measurement pose instead.
        menu.getBoundingClientRect();
        menu.style.transition = transition;
      }
    }

    function measureMenuPosition() {
      if (!menu || !trigger || !root) return;
      const anchor = trigger.getBoundingClientRect();
      // Fixed positioning escapes the saved-rules list's scroll clipping while
      // keeping the menu inside the control for focus and dialog handling.
      menu.style.position = "fixed";
      menu.style.top = "0px";
      menu.style.left = "0px";
      menu.style.margin = "0px";
      const origin = menu.getBoundingClientRect();
      const row = menu.querySelectorAll<HTMLElement>(".settings-select-control__option")[selectedIndex];
      let maxHeight = menuSize === "content" ? window.innerHeight - 16 : Math.min(320, window.innerHeight - 16);
      menu.style.maxHeight = `${maxHeight}px`;
      menu.scrollTop = 0;
      // Measure the longest option including its check slot, independently of
      // the current trigger label and of the previous opening's inline width.
      menu.style.width = "max-content";
      const measuredWidth = menu.getBoundingClientRect().width;
      // WebKit can omit the trailing check slot from a percentage-width flex
      // row's max-content contribution. The label then receives a box that is
      // narrower than its own scroll width even though the popup has room.
      // Recover that hidden width and round up fractional layout measurements.
      const hiddenLabelOverflow = Array.from(
        menu.querySelectorAll<HTMLElement>(".settings-select-control__option-label"),
      ).reduce((largest, label) => Math.max(largest, label.scrollWidth - label.clientWidth), 0);
      const naturalWidth = measuredWidth + Math.max(0, hiddenLabelOverflow);
      const width = Math.min(
        Math.ceil(Math.max(anchor.width + 12, naturalWidth)),
        Math.min(480, window.innerWidth - 16),
      );
      menu.style.width = `${width}px`;
      let height = menu.getBoundingClientRect().height;
      // Match rendered text rather than row centers: borders, padding and
      // fractional line boxes otherwise move the label slightly on opening.
      const triggerText = trigger.querySelector<HTMLElement>("[data-select-label]");
      const optionText = row?.querySelector<HTMLElement>("[data-select-label]");
      const menuRect = menu.getBoundingClientRect();
      const labelRect = triggerText?.getBoundingClientRect();
      const optionRect = optionText?.getBoundingClientRect();
      const rowRect = row?.getBoundingClientRect();
      const desiredTop = labelRect && optionRect
        ? menuRect.top + labelRect.top - optionRect.top
        : menuRect.top + anchor.top + anchor.height / 2 - (rowRect ? rowRect.top + rowRect.height / 2 : menuRect.top);
      const desiredLeft = labelRect && optionRect
        ? menuRect.left + labelRect.left - optionRect.left
        : anchor.left - 6;
      // Preserve label alignment while there is room for a useful list. At a
      // viewport edge, prefer a readable popup over a one-row scroll window.
      const borderHeight = menu.offsetHeight - menu.clientHeight;
      const alignedHeight = Math.max(24, Math.min(
        maxHeight,
        window.innerHeight - 8 - Math.max(8, desiredTop),
        desiredTop + menu.scrollHeight + borderHeight - 8,
      ));
      const minimumUsefulHeight = Math.min(height, (rowRect?.height ?? anchor.height) * 3 + 12);
      if (menuSize === "bounded" && alignedHeight >= minimumUsefulHeight) maxHeight = alignedHeight;
      menu.style.maxHeight = `${maxHeight}px`;
      height = menu.getBoundingClientRect().height;
      const maxScroll = Math.max(0, menu.scrollHeight - menu.clientHeight);
      const lowerTop = Math.max(8, desiredTop);
      const upperTop = Math.min(window.innerHeight - height - 8, desiredTop + maxScroll);
      const preferredTop = maxScroll > 0 ? anchor.top + anchor.height / 2 - height / 2 : desiredTop;
      let top = lowerTop <= upperTop
        ? Math.max(lowerTop, Math.min(preferredTop, upperTop))
        : Math.max(8, Math.min(desiredTop, window.innerHeight - height - 8));
      const requestedScroll = Math.max(0, Math.min(top - desiredTop, maxScroll));
      menu.scrollTop = requestedScroll;
      // Scroll offsets may be rounded to device pixels. Compensate in the
      // floating position so the text stays aligned at fractional font sizes.
      top = Math.max(8, Math.min(top + menu.scrollTop - requestedScroll, window.innerHeight - height - 8));
      const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - width - 8));
      Object.assign(menu.style, {
        position: "fixed", margin: "0px", right: "auto",
        top: `${top - origin.top}px`, left: `${left - origin.left}px`,
        width: `${width}px`, maxHeight: `${maxHeight}px`,
      });
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    // The popup belongs to this scrolled surface; close when that surface moves.
    function handleScroll(event: Event) {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      setIsOpen(false);
    }
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen, placement, menuSize, selectedIndex, options]);

  useLayoutEffect(() => {
    const justOpened = !menuWasOpen.current;
    menuWasOpen.current = isOpen;
    if (!isOpen || (justOpened && placement === "selected" && activeIndex === selectedIndex)) return;
    if (!justOpened && !keyboardNavigation.current) return;
    scrollOptionIntoView(activeIndex);
  }, [isOpen, activeIndex, placement, selectedIndex]);

  function scrollOptionIntoView(index: number) {
    const menu = menuRef.current;
    const row = menu?.querySelectorAll<HTMLElement>(".settings-select-control__option")[index];
    if (!menu || !row) return;
    const bounds = menu.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top + 6) menu.scrollTop -= bounds.top + 6 - item.top;
    else if (item.bottom > bounds.bottom - 6) menu.scrollTop += item.bottom - bounds.bottom + 6;
  }

  if (!selectedOption) return null;

  const activeOption = options[activeIndex] ?? selectedOption;
  const rootClassName = ["settings-select-control", className].filter(Boolean).join(" ");
  const triggerLabel = triggerVisual ? `${ariaLabel}: ${selectedOption.label}` : ariaLabel;
  const optionId = (optionValue: TValue) => `${controlId}-option-${optionValue}`;

  function openMenu() {
    if (disabled) return;
    setActiveIndex(activeIndexForOptions(options, selectedIndex));
    setIsOpen(true);
  }

  function chooseOption(option: SettingsSelectOption<TValue>) {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setIsOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function moveActiveIndex(direction: 1 | -1) {
    const next = nextEnabledIndex(options, activeIndex, direction);
    setActiveIndex(next);
    scrollOptionIntoView(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (options.length === 0 || disabled) return;

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

    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) keyboardNavigation.current = true;
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
        scrollOptionIntoView(firstEnabledIndex(options));
        setIsOpen(true);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastEnabledIndex(options));
        scrollOptionIntoView(lastEnabledIndex(options));
        setIsOpen(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (isOpen) chooseOption(activeOption);
        else openMenu();
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
        }
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
      data-placement={placement}
      data-open={isOpen ? "true" : undefined}
      data-disabled={disabled ? "true" : undefined}
      data-has-accent={selectedOption.accentColor ? "true" : undefined}
      data-placeholder={showPlaceholder ? "true" : undefined}
      style={optionStyle(selectedOption.accentColor)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerVariant === "header-action"
          ? "settings-select-control__header-trigger app-btn app-btn--secondary app-btn--header-action"
          : "settings-select-control__trigger"}
        role="combobox"
        aria-label={triggerLabel}
        title={triggerVisual ? triggerLabel : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? optionId(activeOption.value) : undefined}
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
      >
        {triggerVisual ? (
          <span className="settings-select-control__trigger-visual" aria-hidden="true">{triggerVisual}</span>
        ) : (
          <>
            <span className="settings-select-control__value">
              {showPlaceholder ? null : <OptionIcon option={selectedOption} />}
              <span data-select-label>{showPlaceholder ? placeholder : selectedOption.displayLabel ?? selectedOption.label}</span>
            </span>
            <span className="settings-select-control__chevron" aria-hidden="true" />
          </>
        )}
      </button>
      <AnchoredPresence>{isOpen ? (
        <div ref={menuRef} style={placement === "selected" ? { position: "fixed", margin: 0 } : undefined} className="settings-select-control__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
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
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseOption(option)}
                  onMouseEnter={() => {
                    keyboardNavigation.current = false;
                    if (!optionDisabled) setActiveIndex(index);
                  }}
                >
                  <OptionIcon option={option} />
                  <span className="settings-select-control__option-label">
                    <span className={option.statusLabel ? "settings-select-control__option-title-with-status" : undefined}>
                      <span data-select-label>{option.displayLabel ?? option.label}</span>
                      {option.statusLabel ? (
                        <span className="settings-select-control__option-status" id={`${optionId(option.value)}-status`}>
                          {option.statusLabel}
                        </span>
                      ) : null}
                    </span>
                    {option.description ? <span className="settings-select-control__option-description" id={`${optionId(option.value)}-description`}>{option.description}</span> : null}
                  </span>
                  {placement === "selected" ? <span className="settings-select-control__check" aria-hidden="true">{showsSelectedState ? "✓" : ""}</span> : null}
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
                        onFocus={() => { keyboardNavigation.current = true; setActiveIndex(index); }}
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
      ) : null}</AnchoredPresence>
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
