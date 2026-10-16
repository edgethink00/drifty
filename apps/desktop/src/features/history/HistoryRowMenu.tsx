import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { useLocalization } from "../localization/LocalizationContext";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";

/** Where a History record opens: its week in Your Week, or its day in Your Day. */
export type HistoryRecordSurface = "week" | "day";

export type HistoryRowMenuActions = {
  /** Absent when the app has nowhere to open a record; the menu then only deletes. */
  readonly onOpen?: (row: HistoryRowModel, surface: HistoryRecordSurface) => void;
  readonly onDelete: (row: HistoryRowModel) => void;
  readonly deleteDisabled: boolean;
  /**
   * "Don't record" for this row's site or app: its label, or null when the row
   * offers none (a browser with no site, excluded activity). Absent when the
   * app cannot keep anything out of history.
   */
  readonly excludeLabel?: (row: HistoryRowModel) => string | null;
  readonly onExclude?: (row: HistoryRowModel) => void;
};

type HistoryRowMenuProps = {
  readonly actions: HistoryRowMenuActions;
  /** Excluded activity has no block in either calendar, so it can only be deleted. */
  readonly canOpen: boolean;
  readonly row: HistoryRowModel;
  readonly title: string;
};

type MenuPosition = { readonly top: number; readonly right: number; readonly placement: "below" | "above" };

const MENU_GAP = 4;
const WINDOW_MARGIN = 8;

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** The row's one menu: open the record where it happened, keep its site or
 * app out of history from now on, or delete it.
 *
 * History's list clips its rounded corners, so the menu is placed on the
 * document instead of inside the row, and opens upward when the window has no
 * room below the row. */
export function HistoryRowMenu({ actions, canOpen, row, title }: HistoryRowMenuProps) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  // A list holds hundreds of rows; only a row whose menu has opened keeps a
  // popup layer, which then stays to play its closing motion.
  const [layerMounted, setLayerMounted] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  // Bumped when the row moves under an open menu, so the menu follows it.
  const [anchorMoves, setAnchorMoves] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Keyboard opening lands on an item; a pointer leaves focus where it was.
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const showOpenItems = canOpen && actions.onOpen !== undefined;
  const excludeLabel = actions.onExclude ? actions.excludeLabel?.(row) ?? null : null;

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    // offsetHeight ignores the entry animation's scale.
    const height = menu.offsetHeight;
    const roomBelow = window.innerHeight - anchor.bottom - MENU_GAP - WINDOW_MARGIN;
    const roomAbove = anchor.top - MENU_GAP - WINDOW_MARGIN;
    const above = height > roomBelow && roomAbove > roomBelow;
    setPosition({
      top: above ? anchor.top - MENU_GAP - height : anchor.bottom + MENU_GAP,
      right: Math.max(WINDOW_MARGIN, window.innerWidth - anchor.right),
      placement: above ? "above" : "below",
    });
  }, [anchorMoves, open]);

  // A live record can arrive while the menu is open and push the row down.
  // Follow the row, and close if the row itself goes away.
  useEffect(() => {
    if (!open) return;
    let last = triggerRef.current?.getBoundingClientRect() ?? null;
    let frame = window.requestAnimationFrame(function follow() {
      const trigger = triggerRef.current;
      if (!trigger?.isConnected) {
        setOpen(false);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      if (last && (Math.abs(rect.top - last.top) > 0.5 || Math.abs(rect.right - last.right) > 0.5)) {
        setAnchorMoves((count) => count + 1);
      }
      last = rect;
      frame = window.requestAnimationFrame(follow);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !position || !focusOnOpen.current) return;
    const items = menuItems(menuRef.current);
    (focusOnOpen.current === "first" ? items[0] : items[items.length - 1])?.focus({ preventScroll: true });
    focusOnOpen.current = null;
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      close();
    };
    // The menu is fixed to where the row was; scrolling the list leaves it behind.
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = menuItems(menuRef.current);
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next: HTMLElement | undefined;
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          close();
          triggerRef.current?.focus({ preventScroll: true });
          return;
        case "Tab":
          event.preventDefault();
          close();
          triggerRef.current?.focus({ preventScroll: true });
          return;
        case "ArrowDown":
          next = items[index < 0 ? 0 : (index + 1) % items.length];
          break;
        case "ArrowUp":
          next = items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length];
          break;
        case "Home":
          next = items[0];
          break;
        case "End":
          next = items[items.length - 1];
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      next?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  // One highlight, like a native menu: the pointer moves focus along with it,
  // and leaving the menu clears it until the next key or hover.
  const followPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
  };
  const releasePointerFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && menuRef.current?.contains(active)) active.blur();
  };

  const openRecord = (surface: HistoryRecordSurface) => {
    setOpen(false);
    actions.onOpen?.(row, surface);
  };

  // Its confirmation also returns focus to the trigger.
  const excludeRecord = () => {
    triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    actions.onExclude?.(row);
  };

  // The confirmation returns focus to whatever held it when it opened.
  const deleteRecord = () => {
    triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
    actions.onDelete(row);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="history-row__more"
        aria-label={t("history.rowMenu.trigger", { title })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          if (open) {
            setOpen(false);
            return;
          }
          // Enter and Space click with a detail of 0.
          focusOnOpen.current = event.detail === 0 ? "first" : null;
          setLayerMounted(true);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          focusOnOpen.current = event.key === "ArrowDown" ? "first" : "last";
          setLayerMounted(true);
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.6" r="1.7" /></svg>
      </button>
      {!layerMounted || typeof document === "undefined" ? null : createPortal(
        <AnchoredPresence>{open ? (
          <div
            ref={menuRef}
            className="history-row-menu"
            role="menu"
            aria-label={t("history.rowMenu.label")}
            data-placement={position?.placement ?? "below"}
            style={{ top: position?.top ?? 0, right: position?.right ?? 0, visibility: position ? undefined : "hidden" }}
            onPointerLeave={releasePointerFocus}
          >
            {showOpenItems ? (
              <>
                <button type="button" role="menuitem" tabIndex={-1} onPointerMove={followPointer} onClick={() => openRecord("week")}>
                  <svg {...iconProps}><rect x="2.5" y="3.5" width="11" height="10" rx="1.6" /><path d="M5.5 2v3M10.5 2v3M2.5 7h11" /></svg>
                  {t("history.rowMenu.openWeek")}
                </button>
                <button type="button" role="menuitem" tabIndex={-1} onPointerMove={followPointer} onClick={() => openRecord("day")}>
                  <svg {...iconProps}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2 1.3" /></svg>
                  {t("history.rowMenu.openDay")}
                </button>
                <div className="history-row-menu__separator" role="separator" />
              </>
            ) : null}
            {excludeLabel ? (
              <button type="button" role="menuitem" tabIndex={-1} onPointerMove={followPointer} onClick={excludeRecord}>
                <svg {...iconProps}><path d="M2 8s2.2-4 6-4c1 0 1.9.3 2.7.7M14 8s-2.2 4-6 4c-1 0-1.9-.3-2.7-.7" /><path d="M6.6 9.4a2 2 0 0 1 2.8-2.8M2.5 13.5l11-11" /></svg>
                {excludeLabel}
              </button>
            ) : null}
            <button type="button" role="menuitem" tabIndex={-1} className="danger" disabled={actions.deleteDisabled} onPointerMove={followPointer} onClick={deleteRecord}>
              <svg {...iconProps}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1" /></svg>
              {t("history.rowMenu.delete")}
            </button>
          </div>
        ) : null}</AnchoredPresence>,
        document.body,
      )}
    </>
  );
}
