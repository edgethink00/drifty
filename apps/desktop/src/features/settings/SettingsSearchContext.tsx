import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SettingsSection } from "./SettingsSidebar";
import type { SettingsSearchEntry } from "./settingsSearchCatalog";
import { isSettingsSearchEntryVisible, type SettingsSearchAvailability } from "./settingsSearchIndex";

const defaultAvailability: SettingsSearchAvailability = {
  dev: false, intelligence: false, windows: false, backgroundUpdates: false, signedIn: false, deviceSync: false,
};

type SearchRequest = { readonly entry: SettingsSearchEntry; readonly originSection: SettingsSection | null };
const SettingsSearchContext = createContext({
  request: null as SearchRequest | null,
  availability: defaultAvailability,
  consume: (_request: SearchRequest) => {},
  navigate: (_entry: SettingsSearchEntry) => {},
});
export const useSettingsSearch = () => useContext(SettingsSearchContext);

/** Hands the provider's navigate to code outside it (the account menu lives
 *  above Settings), so a shortcut lands on a setting the same way search does. */
export function SettingsSearchNavigatorBridge({ navigateRef }: {
  readonly navigateRef: { current: ((entry: SettingsSearchEntry) => void) | null };
}) {
  const { navigate } = useSettingsSearch();
  useEffect(() => {
    navigateRef.current = navigate;
  });
  useEffect(() => () => {
    navigateRef.current = null;
  }, [navigateRef]);
  return null;
}

export function SettingsSearchProvider({ activeSection, availability, onNavigate, children }: {
  readonly activeSection: SettingsSection | null;
  readonly availability: SettingsSearchAvailability;
  readonly onNavigate: (entry: SettingsSearchEntry) => void;
  readonly children: ReactNode;
}) {
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const activeRequest = request && request.entry.section === activeSection
    && isSettingsSearchEntryVisible(request.entry, availability) ? request : null;
  const consume = useCallback((completed: SearchRequest) => {
    setRequest((current) => current === completed ? null : current);
  }, []);
  useEffect(() => {
    if (request && (!isSettingsSearchEntryVisible(request.entry, availability) || activeSection === null
      || (activeSection !== request.originSection && activeSection !== request.entry.section))) setRequest(null);
  }, [request, activeSection, availability]);
  return (
    <SettingsSearchContext.Provider value={{
      request: activeRequest,
      availability,
      consume,
      navigate: (entry) => {
        if (!isSettingsSearchEntryVisible(entry, availability)) return;
        setRequest({ entry, originSection: activeSection });
        onNavigate(entry);
      },
    }}>{children}</SettingsSearchContext.Provider>
  );
}

// Observe only the settings destination: lazy cards and tabs can mount after
// navigation. Never click controls or alter preferences to reveal a result.
export function SettingsSearchDestination({ children }: { readonly children: ReactNode }) {
  const { request, consume } = useSettingsSearch();
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<{ node: HTMLElement; tabIndex: string | null } | null>(null);
  const originalTabIndexes = useRef(new WeakMap<HTMLElement, string | null>());
  const [highlight, setHighlight] = useState<{ node: HTMLElement; tabIndex: string | null } | null>(null);
  useEffect(() => {
    if (!highlight) return;
    const { node, tabIndex } = highlight;
    const tabIndexes = originalTabIndexes.current;
    node.setAttribute("tabindex", "-1");
    node.classList.add("settings-search-target");
    const timer = window.setTimeout(() => { highlightRef.current = null; setHighlight(null); }, 2200);
    return () => {
      window.clearTimeout(timer);
      node.classList.remove("settings-search-target");
      const restoreTabIndex = () => {
        if (tabIndex === null) node.removeAttribute("tabindex");
        else node.setAttribute("tabindex", tabIndex);
        tabIndexes.delete(node);
      };
      // Removing tabindex from the focused row blurs it in Chromium. Keep the
      // temporary focus target until the user leaves, including repeat searches.
      if (tabIndex === null && document.activeElement === node) {
        node.addEventListener("blur", restoreTabIndex, { once: true });
      } else restoreTabIndex();
    };
  }, [highlight]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !request) return;
    let frame = 0;
    const visible = (node: HTMLElement) => {
      if (!node.isConnected || node.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
      for (let current: HTMLElement | null = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (current === root) break;
      }
      return true;
    };
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = Array.from(root.querySelectorAll<HTMLElement>("[data-setting-id]"))
          .find((node) => node.dataset.settingId === request.entry.id);
        if (!target || !visible(target)) return;
        if (request.entry.aiProvider && target.querySelector('.collapsible-panel[aria-hidden="true"]')) return;
        const tabIndex = originalTabIndexes.current.has(target)
          ? originalTabIndexes.current.get(target)!
          : target.getAttribute("tabindex");
        originalTabIndexes.current.set(target, tabIndex);
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        if (document.activeElement !== target) {
          if (tabIndex === null) target.removeAttribute("tabindex");
          else target.setAttribute("tabindex", tabIndex);
          originalTabIndexes.current.delete(target);
          return;
        }
        observer.disconnect();
        target.scrollIntoView?.({ block: "center", behavior: "instant" });
        highlightRef.current = { node: target, tabIndex };
        setHighlight(highlightRef.current);
        consume(request);
      });
    };
    const observer = new MutationObserver(reveal);
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["aria-hidden", "hidden", "inert", "open", "class", "style", "data-setting-id"] });
    reveal();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [request, consume]);
  return <div className="settings-panel-stack" ref={rootRef}>{children}</div>;
}
