import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { useSettingsSearch } from "./SettingsSearchContext";
import { searchSettings } from "./settingsSearchIndex";
import { SETTINGS_SECTION_LABELS, type SettingsSearchEntry } from "./settingsSearchCatalog";
import "./SettingsSearch.css";

export function SettingsSearch({ children }: { readonly children: ReactNode }) {
  const { t } = useLocalization();
  const { availability, navigate } = useSettingsSearch();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const results = searchSettings(query, availability);
  const searching = open && query.trim().length > 0;
  useLayoutEffect(() => {
    if (!searching) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 16);
      const top = rect.bottom + 8;
      setPopupStyle({
        top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width,
        maxHeight: Math.max(0, Math.min(400, window.innerHeight - top - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    // A scroll inside the results changes neither the anchor nor the placement.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (rootRef.current) observer?.observe(rootRef.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
      observer?.disconnect();
    };
  }, [searching]);
  useEffect(() => {
    if (!searching) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [searching]);
  const selectedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));
  useLayoutEffect(() => {
    if (!searching) return;
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [searching, selectedIndex]);
  const select = (entry: SettingsSearchEntry) => {
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
    navigate(entry);
  };
  const move = (index: number) => {
    setActiveIndex(index);
  };
  return <>
    <div className="settings-search" ref={rootRef}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || (!rootRef.current?.contains(next) && !popupRef.current?.contains(next))) setOpen(false);
      }}>
      <div className="settings-search__field">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
        <input ref={inputRef} type="search" role="combobox" aria-label={t("settings.search.placeholder")}
          placeholder={t("settings.search.placeholder")} aria-autocomplete="list"
          aria-expanded={searching} aria-controls={searching ? id : undefined}
          aria-activedescendant={searching && results.length ? `${id}-${selectedIndex}` : undefined}
          onFocus={() => setOpen(true)}
          autoComplete="off" spellCheck={false} value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (!searching && query.trim() && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex(event.key === "ArrowUp" ? Math.max(0, results.length - 1) : 0);
              return;
            }
            if (event.key === "Enter" && searching) event.preventDefault();
            if (event.key === "Escape" && searching) {
              event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveIndex(0);
            } else if (searching && results.length) {
              if (event.key === "ArrowDown") { event.preventDefault(); move((selectedIndex + 1) % results.length); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move((selectedIndex + results.length - 1) % results.length); }
              else if (event.key === "Enter") { event.preventDefault(); select(results[selectedIndex]!); }
            }
          }} />
        {query ? <button type="button" className="settings-search__clear" aria-label={t("settings.search.clear")}
          onClick={() => { setQuery(""); setActiveIndex(0); inputRef.current?.focus(); }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button> : null}
      </div>
    </div>
    {createPortal(<AnchoredPresence>{searching ? <div ref={popupRef} style={popupStyle} className={`settings-search__results${results.length ? "" : " settings-search__results--empty"}`}>
      <p className="settings-search__count" role="status">{t(results.length ? "settings.search.count" : "settings.search.empty", { count: results.length })}</p>
      <div id={id} ref={listRef} role="listbox" aria-label={t("settings.search.results")} className="settings-search__list">
        {results.map((entry, index) => <button key={entry.id} id={`${id}-${index}`} type="button"
          role="option" aria-selected={index === selectedIndex} tabIndex={-1}
          className="settings-search__result" onMouseEnter={() => setActiveIndex(index)}
          onMouseDown={(event) => event.preventDefault()} onClick={() => select(entry)}>
          <span className="settings-search__title">{t(entry.titleKey)}</span>
          <span className="settings-search__path">{t(SETTINGS_SECTION_LABELS[entry.section])}</span>
        </button>)}
      </div>
    </div> : null}</AnchoredPresence>, document.body)}
    {children}
  </>;
}
