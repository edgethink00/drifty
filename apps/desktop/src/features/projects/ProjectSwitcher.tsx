import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Project } from "@drifty/domain";

import { AnchoredPresence } from "../../components/AnchoredPresence";
import { useLocalization } from "../localization/LocalizationContext";
import { matchesProjectQuery } from "./projectLibraryView";

const DEFAULT_PROJECT_COLOR = "#6366f1";
/** Past a screenful of projects the menu searches, as the team switcher does. */
export const PROJECT_SWITCHER_SEARCH_FROM = 9;

export interface ProjectSwitcherProps {
  readonly current: Project;
  /** The projects to offer, in the table's order. */
  readonly projects: readonly Project[];
  readonly onPick: (projectId: string) => void;
}

/**
 * The open project's name with a menu of the others, in the table's order, so
 * a long library can be crossed without going back to the table.
 */
export function ProjectSwitcher({ current, projects, onPick }: ProjectSwitcherProps) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const searchable = projects.length >= PROJECT_SWITCHER_SEARCH_FROM;
  const shown = projects.filter((project) => matchesProjectQuery(project, query));

  useEffect(() => {
    if (!open) return;
    const selected = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    selected?.scrollIntoView?.({ block: "nearest" });
    const first = menu.current?.querySelector<HTMLElement>("[data-switcher-search]") ?? selected ?? menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    first?.focus({ preventScroll: true });
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (projectId: string) => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    if (projectId !== current.id) onPick(projectId);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // Home and End move the caret in the search.
    if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1 + items.length) % items.length
          : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <span ref={root} className="project-switcher">
      <button
        ref={trigger}
        type="button"
        className="project-switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("projects.switchAria", { name: current.name })}
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        <span className="pt-swatch" style={{ background: current.color || DEFAULT_PROJECT_COLOR }} aria-hidden="true" />
        <span className="project-switcher__name">{current.name}</span>
        <svg className="project-switcher__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <AnchoredPresence>{open ? (
        <div ref={menu} className="project-switcher__menu" role="menu" aria-label={t("projects.title")} onKeyDown={onMenuKeyDown}>
          {searchable ? (
            <span className="projects-search project-switcher__search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                data-switcher-search
                className="settings-input"
                type="text"
                aria-label={t("projects.searchAria")}
                placeholder={t("projects.switchSearch")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
          ) : null}
          <div className="project-switcher__list">
            {shown.map((project) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={project.id === current.id}
                key={project.id}
                className="project-switcher__item"
                onClick={() => choose(project.id)}
              >
                <span className="pt-swatch" style={{ background: project.color || DEFAULT_PROJECT_COLOR }} aria-hidden="true" />
                <span className="project-switcher__item-name" title={project.name}>{project.name}</span>
                <svg className="project-switcher__check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
              </button>
            ))}
            {shown.length === 0 ? <div className="project-switcher__empty">{t("projects.noFilterMatch")}</div> : null}
          </div>
        </div>
      ) : null}</AnchoredPresence>
    </span>
  );
}
