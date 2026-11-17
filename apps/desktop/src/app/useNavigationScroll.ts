import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { NavigationSnapshot } from "./navigation";

/** Each window-history entry owns its scroll position; a new destination starts at the top. */
export function useNavigationScroll(
  contentRef: RefObject<HTMLElement>,
  entry: NavigationSnapshot,
  settingsSection: string | null,
) {
  const positions = useRef(new WeakMap<NavigationSnapshot, number>());
  const previous = useRef({ entry, settingsSection });
  const pending = useRef<number | null>(null);

  // Called before navigation mutates the shared main element, so a shorter
  // destination cannot clamp the position that the Back button should restore.
  const remember = useCallback(() => {
    const content = contentRef.current;
    if (content) positions.current.set(entry, pending.current ?? content.scrollTop);
  }, [contentRef, entry]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const old = previous.current;
    previous.current = { entry, settingsSection };
    if (!content || (old.entry === entry && old.settingsSection === settingsSection)) return;

    // Settings sections are not window-history entries. Opening another one is
    // a fresh visit even when that section was open earlier in the same entry.
    const target = old.entry === entry ? 0 : positions.current.get(entry) ?? 0;
    pending.current = target > 0 ? target : null;
    content.scrollTop = target;
    if (target <= 0) return;

    // Deferred pages can initially be too short to accept the saved position.
    // Retry as their content appears, but never pull the user back after input.
    let resize: ResizeObserver | null = null;
    const stop = () => {
      pending.current = null;
      mutations.disconnect();
      resize?.disconnect();
      content.removeEventListener("wheel", stop);
      content.removeEventListener("touchstart", stop);
      content.removeEventListener("pointerdown", stop);
      content.removeEventListener("keydown", stop);
    };
    const restore = () => {
      if (pending.current === null) return;
      content.scrollTop = target;
      if (content.scrollHeight - content.clientHeight >= target - 1) stop();
    };
    const observeChildren = () => {
      if (resize) for (const child of Array.from(content.children)) resize.observe(child);
      restore();
    };
    const mutations = new MutationObserver(observeChildren);
    mutations.observe(content, { childList: true, subtree: true });
    if (typeof ResizeObserver !== "undefined") resize = new ResizeObserver(restore);
    content.addEventListener("wheel", stop, { passive: true });
    content.addEventListener("touchstart", stop, { passive: true });
    content.addEventListener("pointerdown", stop, { passive: true });
    content.addEventListener("keydown", stop);
    observeChildren();
    return stop;
  }, [contentRef, entry, settingsSection]);

  return remember;
}
