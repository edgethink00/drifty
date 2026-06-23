import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DropdownProps = {
  options: ReadonlyArray<string>;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  disabled?: boolean;
  keepOpenForOther?: boolean;
  otherText?: string;
  onOtherTextChange?: (value: string) => void;
  searchable?: boolean;
  ariaLabel?: string;
};

type DropdownMenuGeometry = {
  left: number;
  maxHeight: number;
  placement: "top" | "bottom";
  top: number;
  width: number;
};

export function Dropdown({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  keepOpenForOther = true,
  otherText = "",
  onOtherTextChange,
  searchable = false,
  ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuGeometry, setMenuGeometry] = useState<DropdownMenuGeometry | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      const clickedTrigger = rootRef.current?.contains(event.target) ?? false;
      const clickedMenu = menuRef.current?.contains(event.target) ?? false;
      if (!clickedTrigger && !clickedMenu) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    if (!searchable || !search) return options;
    return options.filter((option) => option.toLowerCase().includes(search.toLowerCase()));
  }, [options, search, searchable]);

  const hasOtherSelected = value === "Other";
  const displayValue = value ?? "";
  const menuStyle = menuGeometry
    ? {
        left: `${menuGeometry.left}px`,
        maxHeight: `${menuGeometry.maxHeight}px`,
        position: "fixed" as const,
        right: "auto",
        top: `${menuGeometry.top}px`,
        width: `${menuGeometry.width}px`,
      }
    : undefined;

  useLayoutEffect(() => {
    if (!open) {
      setMenuGeometry(null);
      return;
    }

    function updateMenuGeometry() {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportPadding = 12;
      const preferredMenuHeight = 280;
      const minimumComfortHeight = 180;
      const minimumMenuHeight = 64;
      const menuVerticalPadding = 8;
      const estimatedOptionHeight = 46;
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - viewportPadding);
      const spaceAbove = Math.max(0, rect.top - viewportPadding);
      const placement = spaceBelow < minimumComfortHeight && spaceAbove > spaceBelow ? "top" : "bottom";
      const availableHeight = placement === "top" ? spaceAbove : spaceBelow;
      const unsnappedMaxHeight = Math.min(preferredMenuHeight, availableHeight);
      const visibleOptionRows = Math.max(
        1,
        Math.floor((unsnappedMaxHeight - menuVerticalPadding) / estimatedOptionHeight),
      );
      const snappedMaxHeight = visibleOptionRows * estimatedOptionHeight + menuVerticalPadding;
      const maxHeight = Math.max(minimumMenuHeight, Math.min(unsnappedMaxHeight, snappedMaxHeight));
      const width = Math.max(0, Math.min(rect.width, viewportWidth - viewportPadding * 2));
      const left = Math.max(viewportPadding, Math.min(rect.left, viewportWidth - viewportPadding - width));
      const requestedTop = placement === "top" ? rect.top - maxHeight : rect.bottom;
      const top = Math.max(
        viewportPadding,
        Math.min(requestedTop, viewportHeight - viewportPadding - maxHeight),
      );

      setMenuGeometry({ left, maxHeight, placement, top, width });
    }

    updateMenuGeometry();
    window.addEventListener("resize", updateMenuGeometry);
    window.addEventListener("scroll", updateMenuGeometry, true);
    return () => {
      window.removeEventListener("resize", updateMenuGeometry);
      window.removeEventListener("scroll", updateMenuGeometry, true);
    };
  }, [filtered.length, open]);

  function handleSelect(option: string) {
    if (value === option) {
      onChange(null);
      if (option === "Other") onOtherTextChange?.("");
      setOpen(false);
    } else {
      onChange(option);
      if (option !== "Other" || !keepOpenForOther) {
        setOpen(false);
      }
    }
    setSearch("");
  }

  function handleClear(event: React.MouseEvent) {
    event.stopPropagation();
    onChange(null);
    onOtherTextChange?.("");
    setSearch("");
  }

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const menu = open ? (
    <div
      className="onb-dropdown__menu"
      data-placement={menuGeometry?.placement ?? "bottom"}
      ref={menuRef}
      role="listbox"
      style={menuStyle}
    >
      {filtered.length === 0 ? <div className="onb-dropdown__no-results">No results</div> : null}
      {filtered.map((option) => {
        const isSelected = value === option;
        return (
          <button
            type="button"
            key={option}
            className={`onb-dropdown__option${isSelected ? " onb-dropdown__option--selected" : ""}`}
            onClick={() => handleSelect(option)}
            role="option"
            aria-selected={isSelected}
          >
            {option}
            {isSelected ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </div>
  ) : null;
  const portalTarget = rootRef.current?.closest(".onboarding-screen") ?? (typeof document === "undefined" ? null : document.body);

  return (
    <div className="onb-dropdown" ref={rootRef}>
      <div
        ref={triggerRef}
        className={`onb-dropdown__trigger${open ? " onb-dropdown__trigger--open" : ""}`}
        onClick={openMenu}
        role="combobox"
        aria-disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? placeholder}
        data-disabled={disabled ? "true" : undefined}
      >
        <input
          ref={inputRef}
          className="onb-dropdown__input"
          type="text"
          placeholder={displayValue || placeholder}
          value={open ? search : ""}
          disabled={disabled}
          readOnly={!searchable}
          onChange={(event) => {
            setSearch(event.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <div className="onb-dropdown__icons">
          {value ? (
            <button type="button" className="onb-dropdown__clear" onClick={handleClear} tabIndex={-1} aria-label="Clear selection">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4 4L10 10M10 4L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
          <svg className="onb-dropdown__chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      {menu && portalTarget ? createPortal(menu, portalTarget) : menu}
      {hasOtherSelected && onOtherTextChange ? (
        <input
          className="onb-dropdown__other-input"
          type="text"
          placeholder="Tell us more…"
          value={otherText}
          onChange={(event) => onOtherTextChange(event.target.value)}
          autoFocus
          aria-label={`${ariaLabel ?? placeholder} — other detail`}
        />
      ) : null}
    </div>
  );
}
