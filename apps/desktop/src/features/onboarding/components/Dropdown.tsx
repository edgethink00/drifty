import { useEffect, useMemo, useRef, useState } from "react";

type DropdownProps = {
  options: ReadonlyArray<string>;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  otherText?: string;
  onOtherTextChange?: (value: string) => void;
  searchable?: boolean;
  ariaLabel?: string;
};

export function Dropdown({
  options,
  value,
  onChange,
  placeholder,
  otherText = "",
  onOtherTextChange,
  searchable = false,
  ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
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

  function handleSelect(option: string) {
    if (value === option) {
      onChange(null);
      if (option === "Other") onOtherTextChange?.("");
      setOpen(false);
    } else {
      onChange(option);
      if (option !== "Other") {
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
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="onb-dropdown" ref={rootRef}>
      <div
        className={`onb-dropdown__trigger${open ? " onb-dropdown__trigger--open" : ""}`}
        onClick={openMenu}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? placeholder}
      >
        <input
          ref={inputRef}
          className="onb-dropdown__input"
          type="text"
          placeholder={displayValue || placeholder}
          value={open ? search : ""}
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
      {open ? (
        <div className="onb-dropdown__menu" role="listbox">
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
      ) : null}
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
